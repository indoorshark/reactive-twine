/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import * as rxjs from 'rxjs';
import { Subscription, Observable } from 'rxjs';
import * as immer from 'immer';
import * as R from 'ramda';

import type { Passage, MacroContext } from "twine-sugarcube";

import { EventType } from './event_bus.ts';
import type { IEventBus, BusEvent, IBusEvent, BusEphemeralEvent } from './event_bus.ts';

import type { StoreUpdateManager } from './store_update_manager.ts';

import {
  checkForWikiError,
  injectVariables,
  createAllShadowStore,
  macroIsInDom,
} from "./misc.ts";

import { baseElementNS, defaultMacroNames, PASSAGE_TAGS } from './constants.ts';

const elementNS = `${baseElementNS}/reactive-quest`;

export interface IBaseQuestUpdateEvent extends BusEphemeralEvent {
  name: 'reactiveQuest/questUpdate';
  payload: {
    quest: string,
    type: `updateStatus/${string}`,
  };
}
interface BaseQuestEvent<T extends string, P extends object> extends IBaseQuestUpdateEvent {
  payload: { quest: string } & P & { type: `updateStatus/${T}` }
}
export type QuestCompleteEvent = BaseQuestEvent<'completed', { nextQuest?: string }>
export type QuestBotchedEvent = BaseQuestEvent<'botched', { reason: string }>
export type QuestUnbotchedEvent = BaseQuestEvent<'unbotched', { reason: string }>
export type QuestMentionedEvent = BaseQuestEvent<'mentioned', { force: boolean }>

export type IQuestUpdateEvent = (
  | QuestCompleteEvent
  | QuestBotchedEvent
  | QuestUnbotchedEvent
  | QuestMentionedEvent
)

const setup = SugarCube.setup as (
  typeof SugarCube.setup &
  {
    eventStreams$: IEventBus<IQuestUpdateEvent>,
    EventStore: { StoreUpdateManager: StoreUpdateManager },
    reactiveQuest: { activelyMonitoring: Set<string> },
  }
);

export function findQuestNameFromMacro(
  macroContext: MacroContext,
  names: { reactive_quest: string, questPassingAttr: string }
) {
  const rootNodeOrElem: Node | HTMLElement = macroContext.output.getRootNode();
  const updateContainer = (rootNodeOrElem as HTMLElement).getElementsByTagNameNS?.(
    elementNS,
    'reactive-quest-update-container'
  );

  if (updateContainer?.length > 0) {
    return updateContainer[0].getAttributeNS(elementNS, 'questName');

  } else {
    // it wans't render by us, b/c we exec in reactive-quest-update-container
    // that means this is either render to document (via include or Engine.play)
    // (or this is used out side of <<reactive_quest>>)
    const qauestMacroName = names.reactive_quest;
    const questMacro = macroContext.contextFind(c => c.name === qauestMacroName);
    if (questMacro && (questMacro as any)[names.questPassingAttr]) {
      // when reactive_quest is rendering to DOM, it will attach
      // the quest to this attribute
      return (questMacro as any)[names.questPassingAttr].name;
    }
  }
}

export function registerMacros(questStore: QuestStore, names = defaultMacroNames) {
  names = { ...defaultMacroNames, ...names }

  Macro.add(names.reactive_quest, {
    skipArgs : false,
    tags : [names.quest_line, names.qeust_update_depends_on, names.quest_log],
    handler() {
      const questDef = {} as IQuestDefinition;

      for (const payload of this.payload) {
        switch (payload.name) {
          case names.reactive_quest: {
            break
          }
          case names.quest_line: {
            const [ questLine, stepStr, step ] = payload.args;
            if (stepStr !== "step") {
              const msg = (
                `<<quest_line>> shoud be call like ` +
                `<<quest_line "Name of Quest Line" step "1">>, specifically, ` +
                `the second argument is the literal string 'step' without qoute`
              );
              throw new Error(msg);
            }
            questDef.questLine = {
              name: questLine,
              step: step.split('.'),
            };
            break
          }
          case names.qeust_update_depends_on: {
            questDef.dataDependencies = payload.args;
            break
          }
          case names.quest_log: {
            questDef.script = payload.contents;
            break
          }
        }
      }

      const rootNode = this.output.getRootNode();
      switch (rootNode.nodeType) {
        case document.ELEMENT_NODE: {
          let operation;
          const opType = (name: string) => (rootNode as HTMLElement).getElementsByTagNameNS(elementNS, name);
          if ((operation = opType('reactive-quest-registerer'))[0]) {
            // is registering the quest
            ($(operation).data('registerQuest') as RegisterQuest)(questDef);

          }
          break;
        }
        case document.DOCUMENT_FRAGMENT_NODE:
        case document.DOCUMENT_NODE: {
          // render quest_log to dom
          const quest = questStore.findByQuestLineStep(questDef.questLine);
          // set the quest instance for e.g. <<quest_progress_to>> inside
          (this as any)[names.questPassingAttr] = quest;
          quest.renderQuestLogTo({}, this.output);
          break;
        }
        default: {
          throw new Error("Rendering quest detached from document is not supported");
        }
      }
    }
  });

  Macro.add(names.quest_progress_to, {
    skipArgs : false,
    handler() {
      let nextQuest;
      if (this.args.length !== 1) {
        const msg = "<<quest_progress_to [[Next Quest Name]]>> exectly one argument, i.e. the next quest's name";
        this.error(msg);
      } else {
        nextQuest = this.args[0].link;
      }
      // haven't decide should we support progressing quest outside of quest log
      // if (this.args.length === 2) {
      //   // <<quest_progress_to [[Next Quest Name]] [[Current Quest Name]]>>
      // }

      const questName = findQuestNameFromMacro(this, names);

      if (!questName) {
        const msg = `<<quest_progress_to [[Next Quest Name]]>> must be use in a Passage tagged "${names.reactive_quest}"`;
        if (macroIsInDom(this)) {
          this.error(msg);
        } else {
          throw new Error(msg);
        }
      }

      setup.eventStreams$.emit({
        name: `reactiveQuest/questUpdate`,
        isEphemeral: true,
        payload: {
          quest: questName,
          type: 'updateStatus/completed',
          nextQuest: nextQuest,
        },
      });
    },
  });
  Macro.add(names.quest_complete, {
    skipArgs : false,
    handler() {
      if (this.args.length !== 0) {
        this.error("<<quest_complete>> exectly no argument");
      }

      const questName = findQuestNameFromMacro(this, names);

      if (!questName) {
        const msg = `<<quest_complete>> must be use in a Passage tagged "${names.reactive_quest}"`;
        if (macroIsInDom(this)) {
          this.error(msg);
        } else {
          throw new Error(msg);
        }
      }

      setup.eventStreams$.emit({
        name: `reactiveQuest/questUpdate`,
        isEphemeral: true,
        payload: {
          quest: questName,
          type: 'updateStatus/completed',
        },
      });
    },
  });

  Macro.add(names.quest_botch, {
    skipArgs : false,
    handler() {
      if (this.args.length !== 2 || this.args[0] !== 'due_to') {
        const msg = (
          '<<quest_botch due_to "reason">> take exactlly 2 argument, the literal string ' +
          '"due_to", then the reason as string'
        );
        throw new Error(msg);
      }

      const questName = findQuestNameFromMacro(this, names);

      if (!questName) {
        const msg = `<<quest_botch due_to "reason">> must be use in a Passage tagged "${names.reactive_quest}"`;
        if (macroIsInDom(this)) {
          this.error(msg);
        } else {
          throw new Error(msg);
        }
      }

      setup.eventStreams$.emit({
        name: `reactiveQuest/questUpdate`,
        isEphemeral: true,
        payload: {
          quest: questName,
          type: 'updateStatus/botched',
          reason: this.args[1],
        },
      });
    }
  });
  Macro.add(names.quest_unbotch, {
    skipArgs : false,
    handler() {
      if (this.args.length !== 2 || this.args[0] !== 'from') {
        const msg = (
          '<<quest_unbotch from "which_reason">> take exactlly 2 argument, the literal string ' +
          '"from", then unbotching which reason as string'
        );
        throw new Error(msg);
      }

      const questName = findQuestNameFromMacro(this, names);

      if (!questName) {
        const msg = `<<quest_unbotch from "which_reason">> must be use in a Passage tagged "${names.reactive_quest}"`;
        if (macroIsInDom(this)) {
          this.error(msg);
        } else {
          throw new Error(msg);
        }
      }

      setup.eventStreams$.emit({
        name: `reactiveQuest/questUpdate`,
        isEphemeral: true,
        payload: {
          quest: questName,
          type: 'updateStatus/unbotched',
          reason: this.args[1],
        },
      });
    }
  });
  Macro.add(names.quest_mention, {
    skipArgs : false,
    handler() {
      if (this.args.length !== 1) {
        const msg = (
          '<<quest_mention [[Quest Name]]>> take exactlly 1 argument, the quest'
        );
        throw new Error(msg);
      }

      setup.eventStreams$.emit({
        name: `reactiveQuest/questUpdate`,
        isEphemeral: true,
        payload: {
          quest: this.args[0].link,
          type: 'updateStatus/mentioned',
          force: false,
        },
      });
    }
  });

}

/*
!(function initQuestMetaDataStore() {
  // TODO: this needs to re-sub when state change?
  let metaStore$ = setup.eventStreams$.getValue()["ReactiveQuestMetaDataStoreUpdate"];
  if (!metaStore$) {
    setup.eventStreams$.emit({
      name: "ReactiveQuest/MetaDataStoreUpdate",
      isEphemeral: false,
      stateName: 'ReactiveQuest/MetaData',
      payload: (
        State.variables['ReactiveQuest/MetaData'] ??
        { init: 4 }
      ),
    });
    metaStore$ = setup.eventStreams$.persistent.getStoreUpdateStream('ReactiveQuest/MetaData')
    metaStore$.subscribe(value => { State.variables['ReactiveQuest/MetaData'] = value });

    if (!State.variables['ReactiveQuest/MetaData']) {
      State.variables['ReactiveQuest/MetaData'] = metaStore$.getValue();
      console.log('setus')
    }
    console.log('sh', State.variables['ReactiveQuest/MetaData'])
  }
}());*/

/*setup.eventStreams$.emit({
  name: "ReactiveQuest/MetaDataStoreUpdate",
  payload: {
  },
});*/

/*setup.eventStreams$.updateStores(
  ["ReactiveQuest/MetaData"],
  draft => {
    const restoreShadowStore = createShadowStore(State, draft);
    try {
      new Wikifier(this.output, this.payload[0].contents);
      for (let storeName of storeNames) {
        const attrName = poorManCamelCase(storeName);
        draft[attrName] = State.temporary[attrName];
      }
    }
    catch (e) {
      this.error(e);
    }
    finally {
      restoreShadowStore();
    }
  }
);*/

export class QuestStore extends Map<string, Quest> {
  questLines = new Map<string, Map<string, Quest>>();

  override get(name: string) {
    const result = super.get(name);
    if (!result) throw new Error(`quest "${name}" not found`);
    return result;
  }

  override set(): never {
    throw new Error("set on QuestStore is not supported");
  }

  add(quest: Quest) {
    super.set(quest.name, quest);

    const questLineCache = this.questLines.get(quest.questLine.name);
    const stepStr = quest.questLine.step.join('.');
    if (!questLineCache) {
      this.questLines.set(
        quest.questLine.name,
        new Map([[stepStr, quest]])
      );

    } else if (!questLineCache.has(stepStr)) {
      questLineCache.set(stepStr, quest);

    } else {
      const msg = (
        `Quest line "${quest.questLine.name}" already had step ` +
        `${stepStr} (${questLineCache.get(stepStr)!.name}), but another quest ` +
        `"${questLineCache.get(stepStr)!.name}" also have the same step`
      );
      throw new Error(msg);
    }
  }

  findByQuestLineStep(questLine: IQuestDefinition['questLine']) {
    const quest = this.questLines.get(questLine.name)?.get(questLine.step.join('.'));
    if (!quest) {
      const msg = (
        `Cannot find quest for ${questLine.name} @ ${questLine.step.join('.')} ` +
        `the quest either doesn't exists or unloaded`
      );
      throw new Error(msg);
    }
    return quest;
  }

  override delete(): false {
    throw new Error("QuestStore does not support delete by element");
  }

  override clear() {
    super.clear();
    this.questLines.clear();
  }

  sortQuestLine() {
    type Step = Quest['questLine']['step'];
    function compareVersionArray(lhs: Step, rhs: Step) {
      const length = lhs.length < rhs.length ? lhs.length : rhs.length;
      for (let i = 0; i < length; i++) {
        if (lhs[i] < rhs[i]) {
          return -1;
        } else if (lhs[i] > rhs[i]) {
          return 1;
        } else {
          continue;
        }
      }
      if (lhs.length === rhs.length) {
        return 0;
      } else if (lhs.length < rhs.length) {
        return -1;
      } else {
        return 1;
      }
    }

    for (const [name, questLine] of [...this.questLines]) {
      const questsInOrder = R.sort(
        (questA, questB) => (
          compareVersionArray(
            questA.questLine.step,
            questB.questLine.step
          )
        ),
        Array.from(questLine.values()),
      );
      this.questLines.set(
        name,
        new Map(questsInOrder.map(quest =>
          [ quest.questLine.step.join('.'), quest ]
        ))
      );
    }
  }
}

type RegisterQuest = (questDef: IQuestDefinition) => void;
interface IQuestDefinition {
  questLine: { name: string, step: string[] },
  dataDependencies: string[],
  script: string,
}

export enum Statuses {
  UNKNOWN = "unknown",
  MENTIONED = "mentioned",
  ACCEPTED = "accepted",
  ACHIVED = "achived",
  COMPLETED = "completed",
  // BOTCHED: "botched",
}

export interface IBaseQuestState {
  status: Statuses,
  botchedReasons?: Record<string, string>,
}

export class Quest {
  #passage: Passage;
  #dataDependencies: {
    stores: string[],
    basicEvents: string[],
  };
  #dataUpdateSubscription?: Subscription;
  #script: string;

  isAttached: boolean = false;
  questLine: {
    name: string,
    step: (number | string)[],
  }

  static Statuses = Statuses;

  static initialState : IBaseQuestState = {
    status: Statuses.UNKNOWN,
  }

  constructor(questDefinition: IQuestDefinition, passage: Passage) {
    this.#passage = passage;
    this.questLine = {
      name: questDefinition.questLine.name,
      step: (questDefinition.questLine.step || []).map((strVal =>
        isNaN(strVal as unknown as number) ? strVal : parseInt(strVal)
      )),
    }
    this.#script = questDefinition.script;
    this.#dataDependencies = Quest.groupDataDependencies(
      questDefinition.dataDependencies
    );
    if (this.#dataDependencies.stores.includes(this.name)) {
      throw new Error("A quest cannot have itself as a dependency, perhaps you can use an event instead?");
    }
  }
  
  get name() {
    return this.#passage.name;
  }

  static groupDataDependencies(dependencies: IQuestDefinition['dataDependencies']) {
    const result = {
      stores: [] as string[],
      basicEvents: [] as string[],
    };
    for (const name of dependencies) { 
      let type : keyof typeof result;
      switch (EventType.resolveByName(name)) {
      case EventType.STORE_UPDATE:
        type = 'stores';
        break
      default:
        type = 'basicEvents'
        break
      }
      result[type].push(name);
    }
    return result;
  }
  
  // #questLogWikifyElement = (function (){
  //   const root = document.createElementNS(elementNS, 'reactive-quest-root')
  //   const elem = document.createElementNS(elementNS, 'reactive-quest-update-container')
  //   root.appendChild(elem);
  //   return root;
  // }());

  updateQuestLog(basicEvents: Record<IBusEvent['name'], unknown>) {
    const root = document.createElementNS(elementNS, 'reactive-quest-root');
    const elem = document.createElementNS(elementNS, 'reactive-quest-update-container');
    elem.setAttributeNS(elementNS, 'questName', this.name);
    root.appendChild(elem);
    this.renderQuestLogTo(basicEvents, elem);
  }

  renderQuestLogTo(basicEvents: Record<IBusEvent['name'], unknown>, output: Node) {
    const questStoreName = this.#passage.name;
    const eventBus: IEventBus<BusEvent> = setup.eventStreams$ as IEventBus<any>;
    let allStores = { ...eventBus.getStoresValue(
      this.#dataDependencies.stores.concat(questStoreName)
    )};

    const oldQuestStore = {
      ...Quest.initialState,
      ...allStores[questStoreName]
    }
    delete allStores[questStoreName];

    const allRelatedBasicEvents = {
      ...Object.fromEntries(
        this.#dataDependencies.basicEvents.map(n => [n, null])
      ),
      ...basicEvents
    };

    // const newQuestStore = immer.finishDraft(
    //   questStoreDraft,
    //   (patches, inversePatches) => {
    //     const patches = setup.EventStore.patches;
    //     if (!(questStoreName in patches)) {
    //       patches[questStoreName] = [];
    //     }
    //     patches[questStoreName].push({
    //       at: ,
    //     });
    //     .set(Date.now(), patches);
    //   }
    // );

    const [draftId, questStoreDraft] = setup.EventStore.StoreUpdateManager.createDraft(
      questStoreName,
      oldQuestStore
    );

    let oldAllStores;
    if (Config.debug) {
      console.groupCollapsed(`[QuestLog]:evaluate "${this.name}"`);
      console.info(oldQuestStore);
      console.info(basicEvents);
      console.groupEnd();
      allStores = immer.createDraft(allStores);
      oldAllStores = { ...allStores };
    }

    const restoreShadowStores = [
      injectVariables(State, { ...allStores, Quest: questStoreDraft }),
      createAllShadowStore(State, allRelatedBasicEvents)
    ];

    try {
      new Wikifier(output, this.#script);
    }
    finally {
      for (const restore of restoreShadowStores) restore();
    }

    if (Config.debug) { 
      for (const storeName of this.#dataDependencies.stores) {
        if (allStores[storeName] !== oldAllStores![storeName]) {
          const msg = (
            "Don't try to update the quest dependency in the very same quest directly!\nFirstly, " +
            "The quest store should reflect the state of the quest itself, not " +
            "to update external data. Additionally, having the quest updating it's own dependency " +
            "is a fast path to infinite loop.\n" +
            `However, if you really wanted to, you can try using a <<access_store [[${storeName}]]>> macro.`
          );
          console.error(msg);
          throw new Error(msg);
        }
      }
      immer.finishDraft(allStores);
    }

    const newQuestStore = setup.EventStore.StoreUpdateManager.commit(
      draftId,
      questStoreDraft
    );

    // if (newQuestStore !== oldQuestStore) {
    //   console.log('the bad')
    //   setup.eventStreams$.emit({
    //     name: `${questStoreName}StoreUpdate`,
    //     payload: newQuestStore,
    //     isEphemeral: false,
    //     stateName: questStoreName,
    //   });
    // }

    if (!output.isConnected) {
      checkForWikiError(output);
    }
  }

  updateStatus(newStatus: Statuses) {
    setup.EventStore.StoreUpdateManager.update(
      this.name,
      (draft: immer.Draft<Partial<IBaseQuestState>>) => {
        draft.status = newStatus;
      }
    );
  }
  botch(reason: string) {
    setup.EventStore.StoreUpdateManager.update(
      this.name,
      (draft: immer.Draft<Partial<IBaseQuestState>>) => {
        if (!draft.botchedReasons) {
          draft.botchedReasons = {};
        }
        draft.botchedReasons[reason] = reason;
      }
    );
  }
  unbotch(reason: string) {
    setup.EventStore.StoreUpdateManager.update(
      this.name,
      (draft: immer.Draft<Partial<IBaseQuestState>>) => {
        delete draft.botchedReasons?.[reason];
        if (draft.botchedReasons && Object.keys(draft.botchedReasons).length <= 0) {
          delete draft.botchedReasons;
        }
      }
    );
  }
  mentioned(force: boolean) {
    setup.EventStore.StoreUpdateManager.update(
      this.name,
      (draft: immer.Draft<Partial<IBaseQuestState>>) => {
        if (
          !draft.status || // no status === uninitialized === unknown
          draft.status === Quest.Statuses.UNKNOWN ||
          force
        ) {
          draft.status = Quest.Statuses.MENTIONED;
        }
      }
    );
  }

  attach() {
    if (Config.debug) {
      console.info(`[ReactiveQuest]:monitoring "${this.name}"`);
    }
    if (this.isAttached) {
      const msg = (
        `Quest ${this.name} is already being actively monitored,` +
        "but it was called to be monitored again. Techinally " +
        'it has no ill effect in and of itself, but it ' +
        'suggest that the ReactiveQuest library is doing something wrong'
      );
      console.error(msg);
    } else {
      this.isAttached = true;
      this.listenUpdate();
      setup.reactiveQuest.activelyMonitoring.add(this.name);
    }
  }

  detach() {
    if (Config.debug) {
      console.info(`[ReactiveQuest]:stop monitoring "${this.name}"`);
    }
    if (this.#dataUpdateSubscription) {
      this.#dataUpdateSubscription.unsubscribe();
      this.#dataUpdateSubscription = undefined;
    }
    this.isAttached = false;
    setup.reactiveQuest.activelyMonitoring.delete(this.name);
  }

  listenUpdate() {
    if (this.#dataUpdateSubscription) throw new Error('already registered');

    const eventBus: IEventBus<BusEvent> = setup.eventStreams$ as IEventBus<any>;

    const storesUpdates$ = rxjs.combineLatest(
      this.#dataDependencies.stores.map(
        n => eventBus.persistent.getStoreUpdateStream(n)
      ),
    ).pipe(
      rxjs.map(() => ({}))
    );

    const mergedBasicEvents$ = rxjs.merge(
      ...this.#dataDependencies.basicEvents.map(
        name => eventBus.persistent.getEventStream(name).pipe(
          rxjs.map(ev => ({ [name]: ev }))
        )
      ),
    );

    const stream$ = mergedBasicEvents$.pipe(
      rxjs.mergeWith(storesUpdates$),
    ) as Observable<Record<string, Record<string, unknown>>>;

    stream$.pipe(
      rxjs.buffer(stream$.pipe(rxjs.debounceTime(0))),
      rxjs.map((arr: Record<string, unknown>[]) => Object.assign({}, ...arr)),
    ).subscribe({
      next: (basicEvents) => {
        this.updateQuestLog(basicEvents);
      },
      complete: () => this.detach(),
    });
  }
}

function registerQuests(quests: QuestStore, questPassages: Passage[]) {
  const root = document.createElementNS(elementNS, 'reactive-quest-root');
  const $registerer = $(document.createElementNS(elementNS, 'reactive-quest-registerer'));
  $registerer.appendTo(root);

  for (const questPassage of questPassages) {
    $registerer.data(
      'registerQuest',
      (questDefinition => {
        const quest = new Quest(questDefinition, questPassage);
        quests.add(quest);
      }) as RegisterQuest
    );

    new Wikifier($registerer[0], questPassage.text);
  }
  quests.sortQuestLine();
  // ATM, activelyMonitoring is mainly for debugging
  // if you need, try to use quest.isAttached instead
  setup.reactiveQuest = { activelyMonitoring: new Set() };
};


function attachToAllBlockingQuest(quests: QuestStore) {
  rxjs.fromEvent($(document), ':passageinit').pipe(
    rxjs.map(() => {
      const eventBus = setup.eventStreams$;
      const baseStores = eventBus.getValue();
      const result = new Set<Quest>();
      for (const questLine of quests.questLines.values()) {
        for (const quest of questLine.values()) {
          type Q = typeof Quest['initialState'] | Record<string, never>;
          const state = eventBus._getStoreValue(quest.name, baseStores) as Q;

          if (!Object.keys(state).length) {
            // empty state => not init yet
            // i.e. it would use Quest.initialState.status
            // which is Quest.Statuses.UNKNOWN
            return result.add(quest);
          } else if (state.status !== Quest.Statuses.COMPLETED) {
            return result.add(quest);
          }

        }
      }
      return result;
    }),
    rxjs.startWith(new Set<Quest>([])),
    rxjs.pairwise(),
  ).subscribe(([oldQuests, newQuests]) => {
    for (const oldQuest of oldQuests) {
      if (!newQuests.has(oldQuest)) oldQuest.detach()
    };
    for (const newQuest of newQuests) {
      if (!oldQuests.has(newQuest)) newQuest.attach()
    };
  });
};


function handleQuestProgress(quests: Pick<QuestStore, 'get'>) {
  return setup.eventStreams$.persistent
    .getEventStream('reactiveQuest/questUpdate')
    .subscribe(event => {
      if (Config.debug) {
        console.groupCollapsed("[ReactiveQuest]:quest_update");
        console.info(event);
        console.groupEnd();
      }
      switch (event.type) {
        case "updateStatus/completed": {
          const prevQuest = quests.get(event.quest);
          prevQuest.detach();
          prevQuest.updateStatus(Quest.Statuses.COMPLETED);
          const nextQuest: Quest | null = event.nextQuest ? quests.get(event.nextQuest) : null;
          if (!event.nextQuest) {
            // event don't have next quest
            // presumably end of the quest line

          } else if (!nextQuest) {
            // event has next quest, but the passage not found
            const msg = (
              `quest named "${event.nextQuest}" not found\n` +
              `make sure this quest passage exists and is ` +
              `tagged as "${PASSAGE_TAGS.REACTIVE_QUEST}"`
            );
            throw new Error(msg);

          } else if (nextQuest.isAttached) {
            // quest is already loaded
            // maybe there's are multiple parent
            // quest progress to the same child?
            const msg = (
              `Reactive quest ${prevQuest.name} is already loaded, ` +
              `but receive load event again`
            )
            console.info(msg);

          } else {
            nextQuest.attach();
          }
          break;
        }
        case "updateStatus/botched": {
          quests.get(event.quest).botch(event.reason);
          break;
        }
        case "updateStatus/unbotched": {
          quests.get(event.quest).unbotch(event.reason);
          break;
        }
        case "updateStatus/mentioned": {
          quests.get(event.quest).mentioned(event.force);
          break;
        }
        default: throw new Error("unknow quest event type")
      }
    });
}


export function init (questStore: QuestStore) {
  setup.eventStreams$.persistent.questsLoadEvent$.subscribe(
    (newQuests) => {
      registerQuests(questStore, [...newQuests].map(Story.get))
    }
  );

  attachToAllBlockingQuest(questStore);
  handleQuestProgress(questStore);
}


