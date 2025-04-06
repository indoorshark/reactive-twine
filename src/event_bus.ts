/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import * as rxjs from 'rxjs';
import { Subject, BehaviorSubject } from 'rxjs';
import type { Observable, Observer } from 'rxjs';
import { createDraft, finishDraft } from 'immer';
import type { Draft } from 'immer';
import * as R from 'ramda';

import type { MacroContext, Passage } from 'twine-sugarcube';

import { StoreUpdateManager } from './store_update_manager.ts';

import {
  macroIsInDom,
  createShadowStore,
  injectVariables,
  storeEnrichmentHandler,
  getStorePseudoPrototype,
} from './misc.ts';

import {
  baseElementNS,
  GET_STORE_PSEUDO_PROTOTYPE_KEY,
  defaultMacroNames,
  PASSAGE_TAGS,
  STORY_EVENTS,
  DEFAULT_EVENT_STORE_STATE_KEY,
} from './constants.ts';


const elementNS = `${baseElementNS}/event-bus`;

const DEFAULT_STORE_VALUE_GETTER_ATTR = 'getDefaultStoreValue';

export class EventType {
  static STORE_UPDATE = Symbol('store_update');
  static BASIC = Symbol('basic');
  static resolveByName(name: string) {
    if (name[0] === name[0].toUpperCase()) {
      return EventType.STORE_UPDATE;
    } else {
      return EventType.BASIC;
    }
  }
}

function getStoreDefaultValue(statePath: string[], name: string): Record<string, unknown> {
  const storedState: Record<string, unknown> | undefined = R.path(
    statePath,
    State.variables
  );

  if (storedState) {
    return storedState;
  }

  // it seem the passage.element is an undocumented attribute,
  // dropping this cache shouldn't affect the preformance too much,
  // hopfully the state would have a new value
  const passage = Story.get(name);
  // const $passageElem = $(passage.element);
  // const dataAttrName = `ReactiveTwineEventBusDefaultStoreValue`;
  // let val = $passageElem.data(dataAttrName);
  // if (val) return val;

  const root = document.createElementNS(elementNS, 'default-store-value-receiver');
  new Wikifier(root as HTMLElement, passage.text);
  const elem = root.getElementsByTagNameNS(elementNS, 'default-store-value');
  const valueGetter = $(elem).data(DEFAULT_STORE_VALUE_GETTER_ATTR) as any as (() => unknown);
  const result : any = valueGetter ? valueGetter() : {};

  // $passageElem.data(dataAttrName, result);
  return result;
}

type GetGroupedStreamEvent<T extends IBusEvent, Name extends string> = (
  Extract<T, { name: Name }>['payload']
)
export interface IBusEvent {
  name: string;
  payload: Record<string, unknown>;
  isAction?: boolean;
  isEphemeral?: boolean;
  errorContext?: MacroContext;
}
export interface BusEphemeralEvent extends IBusEvent {
  name: string;
  payload: Record<string, unknown>;
  isEphemeral: true;
  stateName: never;
}
export interface BusStoreEvent<N extends string = string> extends IBusEvent {
  name: `${N}StoreUpdate`;
  payload: Record<string, unknown>;
  isEphemeral: false;
  stateName: N;
}
type StoreNames<
  Events extends BusEvent,
> = (Events & BusStoreEvent)['name'] extends `${infer N}StoreUpdate` ? N : never;
export interface LoadPassageEvent extends IBusEvent {
  name: STORY_EVENTS.PASSAGES_LOAD,
  isAction: false,
  isEphemeral: true,
  payload: { passages: Passage[] },
}
export type BusEvent = BusEphemeralEvent | BusStoreEvent | LoadPassageEvent;
type AllConcreteEventTypes = (
  | LoadPassageEvent
);
export type FilteredSafeEventType<CustomEvents extends IBusEvent> = (
  Exclude<CustomEvents, { name: AllConcreteEventTypes['name'] }> | Extract<AllConcreteEventTypes, { name: CustomEvents['name'] }>
);
type GetEventType<AllEventType extends IBusEvent, N extends string> = (
  N extends AllConcreteEventTypes['name']
    ? Extract<AllConcreteEventTypes, { name: N }>
    : Extract<AllEventType, { name: N }>
);
type GroupedEventPayload<AllEvents extends BusEvent> = {
  [K in AllEvents['name']]: Extract<AllEvents, { name: K }>['payload']
};
type Grouped$<AllEvents extends BusEvent, G = GroupedEventPayload<AllEvents>> = {
  [K in keyof G]: Observable<G[K]>
};
type GroupedSubjects<AllEvents extends BusEvent, G = GroupedEventPayload<AllEvents>> = {
  [K in keyof G]: Subject<G[K]>
};
type GroupedBehaviorSubjects<AllEvents extends BusEvent, G = GroupedEventPayload<AllEvents>> = {
  [K in keyof G]: BehaviorSubject<G[K]>
};
type RequiredUnion<T, R> = T extends R ? T : T | R;
type WithConcreteEvents<T extends BusEvent> = RequiredUnion<T, AllConcreteEventTypes>;


export interface IPersistentEventBus<
  AllEventType extends FilteredSafeEventType<RequiredUnion<BusEvent, LoadPassageEvent>>,
> extends Pick<
  IEventBus<AllEventType>,
  'groupedStreams$' | 'stream' | 'emit' | 'getEventStream' | 'getStoreUpdateStream'
> {
  questsLoadEvent$: Observable<Set<string>>
  storesLoadEvent$: Observable<Set<string>>

  getEventStream<N extends AllEventType['name']>(streamName: N): Observable<GetEventType<AllEventType, N>['payload']>
}
export interface IEventBus<AllEventType extends BusEvent = BusEvent> {
  groupedStreams$: Observable<Grouped$<AllEventType>>
  stream: Observable<AllEventType>

  persistent: IPersistentEventBus<AllEventType>

  readonly statePath: string[]

  emit<E extends IBusEvent = AllEventType>(event: E): void 

  getValue(): Grouped$<AllEventType>
  getStoreValue<N extends StoreNames<AllEventType>>(storeName: N): GetEventType<AllEventType, `${N}StoreUpdate`>['payload']
  _getStoreValue<
    N extends StoreNames<AllEventType>,
    E extends AllEventType & BusStoreEvent & { name: `${N}StoreUpdate` },
  >(storeName: N, allStores: GroupedBehaviorSubjects<E>): E['payload']
  getStoresValue<
    Ns extends StoreNames<AllEventType & BusStoreEvent>[]
  >(storeNames: Ns): { [K in Ns[number]]: GetEventType<AllEventType, `${K}StoreUpdate`>['payload'] }

  getEventStream<N extends StoreNames<AllEventType>>(streamName: N): Observable<GetEventType<AllEventType, N>['payload']>
  getStoreUpdateStream<N extends StoreNames<AllEventType>>(storeName: N): Observable<GetEventType<AllEventType, `${N}Storeupdate`>['payload']>
}

abstract class BaseBus<AllEventType extends BusEvent> {
  abstract getEventStream<N extends AllEventType['name']>(streamName: N): Observable<GetEventType<AllEventType, N>['payload']>

  constructor(
    public groupedStreams$: BehaviorSubject<GroupedSubjects<AllEventType>>,
  ) { }

  getStoreUpdateStream<N extends string>(storeName: N) {
    const eventStreamName = `${storeName}StoreUpdate` as AllEventType['name'];
    return this.getEventStream(eventStreamName)
    //   rxjs.startWith(this.getStoreValue(storeName))
  }

  public abstract get statePath(): string[]
}
export class Bus<
  AllEventType extends FilteredSafeEventType<RequiredUnion<WithConcreteEvents<BusEvent>, LoadPassageEvent>>,
> extends BaseBus<AllEventType> implements IEventBus<AllEventType> {

  stream: Subject<AllEventType>;

  persistent: IPersistentEventBus<AllEventType>;

  constructor(
    public statePath: string[],
    persistenceCarrier?: IPersistentEventBus<AllEventType>
  ) {
    type Groups = Map<AllEventType['name'], Subject<AllEventType['payload']>>;

    super(
      new BehaviorSubject({} as GroupedSubjects<AllEventType>),
    );

    this.stream = new Subject();

    const that = this;
    this.stream.subscribe(({
      groups: new Map() as Groups,
      next(this: { groups: Groups }, event) {
        // I would love to use rxjs' groupBy,
        // however it's quite a lot harder to
        // use the first value as initival value for BehaviorSubject
        // without introducing unordered-ness between
        // emit and next read, so we just roll our own groupBy
        // type GroupedStreamWithKey = Subject<typeof event.payload> & { key: string };
        const eventName = event.name as AllEventType['name'];
        const group$ = this.groups.get(eventName);

        if (group$) {
          group$.next(event.payload);
        } else {
          switch (EventType.resolveByName(event.name)) {
            case EventType.STORE_UPDATE: {
              const group$ = Object.assign(
                new rxjs.BehaviorSubject(event.payload),
                { key: eventName }
              );

              this.groups.set(group$.key, group$);
              that.groupedStreams$.next(Object.fromEntries(this.groups.entries()) as any);

              break;
            }
            default: {
              const group$ = Object.assign(
                new rxjs.ReplaySubject<typeof event.payload>(1),
                { key: eventName }
              );

              this.groups.set(group$.key, group$);
              that.groupedStreams$.next(Object.fromEntries(this.groups.entries()) as any);

              // need to emit the grouped$ before emitting the inner
              // stream's event, b/c PersistentBus subscribe/switch on grouped$
              // and if we just emit to group$ without letting PersistentBus know
              // it would leave no chance of anyone listening to that event
              group$.next(event.payload);

              break;
            }
          }
        }
      },
      complete(this: { groups: Groups }) {
        for (const [_, group] of this.groups) {
          group.complete();
        }
        this.groups.clear();
        that.groupedStreams$.complete();
      },
      error(e) { throw e },
    } as Observer<BusEvent>));

    this.persistent = persistenceCarrier || new PersistentBus<AllEventType>(this);
  }

  regenerate() {
    const newStore = new Bus<AllEventType>(
      this.statePath,
      this.persistent
    );
    (this.persistent as unknown as PersistentBus<AllEventType>).update(newStore);
    this.destruct();
    return newStore;
  }

  emit<E extends IBusEvent = AllEventType>(ev: E) {
    if (Config.debug) {
      console.groupCollapsed(`[EventStore] ${ev.name}`);
      console.debug(ev);
      console.groupEnd();
    }
    this.stream.next(ev as unknown as AllEventType);
  }

  destruct() {
    this.stream.complete();
  }

  getValue(): Grouped$<AllEventType> {
    return this.groupedStreams$.getValue();
  }

  getEventStream<N extends AllEventType['name']>(streamName: N): Observable<GetEventType<AllEventType, N>['payload']> {
    if (streamName in this.getValue()) {
      return this.getValue()[streamName];
    } else {
      return this.groupedStreams$.pipe(
        rxjs.filter(groups => (streamName in groups)),
        rxjs.take(1),
        rxjs.mergeMap(groups => groups[streamName]),
      );
    }
  }

  getStoreValue< N extends StoreNames<AllEventType> >(storeName: N) {
    type S = GroupedBehaviorSubjects<AllEventType & BusStoreEvent>;
    const state = this.groupedStreams$.getValue() as S;
    return this._getStoreValue(storeName, state);
  }

  _getStoreValue<
    N extends StoreNames<AllEventType>,
    E extends AllEventType & BusStoreEvent & { name: `${N}StoreUpdate` },
  >(storeName: N, allStores: GroupedBehaviorSubjects<E>): E['payload'] {
    if (`${storeName}StoreUpdate` in allStores) {
      const substore = allStores[`${storeName}StoreUpdate`];
      return substore.getValue();
    } else {
      return getStoreDefaultValue(
        this.statePath.concat(storeName),
        storeName
      );
    }
  }

  getStoresValue<Ns extends StoreNames<AllEventType & BusStoreEvent>[]>(storeNames: Ns) {
    type S = GroupedBehaviorSubjects<GetEventType<AllEventType, `${Ns[number]}StoreUpdate`>>;
    type Result = { [K in Ns[number]]: GetEventType<AllEventType, `${K}StoreUpdate`>['payload'] };
    const allStores = this.groupedStreams$.getValue() as S;
    const result = {} as Result;
    for (const name of storeNames) {
      result[name] = this._getStoreValue(name, allStores)
    }
    return result;
  }

  updateStores<Ns extends StoreNames<AllEventType & BusStoreEvent>[]>(
    storeNames: Ns,
    cb: (draft: { [K in Ns[number]]: Draft<GetEventType<AllEventType, K>['payload']> }) => void,
    errorContext: MacroContext,
  ) {
    type Stores = { [K in Ns[number]]: Draft<(GetEventType<AllEventType & BusStoreEvent, K>)['payload']> };
    type DraftStores = { [K in Ns[number]]: Draft<(GetEventType<AllEventType & BusStoreEvent, K>)['payload']> };
    const currentStores  = this.getStoresValue(storeNames);

    const draft = createDraft(currentStores);

    const pseudoPrototypes = new Map();
    const enrichedDraft = {} as Parameters<typeof cb>[0];

    for (const name of storeNames) {
      pseudoPrototypes.set(name, getStorePseudoPrototype(name));
      enrichedDraft[name] = new Proxy(
        (draft as DraftStores)[name],
        Object.create(
          storeEnrichmentHandler,
          {
            targetPrototype: { value: pseudoPrototypes.get(name) },
            errorContext: { value: errorContext },
          }
        )
      );
    }
    const oldStoreReference = Object.assign({}, enrichedDraft);

    const cbReturn = cb(enrichedDraft);

    for (const name of storeNames) {
      if (enrichedDraft[name] !== oldStoreReference[name]) {
        // e.g. State.variabels.Store = {}
        (draft as DraftStores)[name] = enrichedDraft[name]
      }
    }

    const newStores = finishDraft(draft) as Stores;

    if (Config.debug) {
      function reportAccessError(attr: string) {
        const msg = `Attempting to assign a store using a computed attribute: "${attr}"`;
        console.error(msg)
        if (macroIsInDom(errorContext)) {
          errorContext.error(msg);
        } else {
          throw new Error(msg);
        }
      }
      for (const name of storeNames) {
        const store = newStores[name];
        const pseudoPrototype = pseudoPrototypes.get(name);
        for (const attr in pseudoPrototype) {
          if (!store || attr in store) reportAccessError(attr)
        }
      }
    }

    for (const name of storeNames) {
      if (newStores[name] !== currentStores[name]) {
        this.emit({
          name: `${name}StoreUpdate` as `${string}StoreUpdate`,
          payload: newStores[name],
          isEphemeral: false,
          stateName: name,
        });
      }
    }

    return cbReturn;
  }
}

class PersistentBus<
  AllEventType extends FilteredSafeEventType<RequiredUnion<BusEvent, LoadPassageEvent>>,
  T extends IEventBus<AllEventType> = IEventBus<AllEventType>,
> extends BaseBus<AllEventType> implements IPersistentEventBus<AllEventType> {

  #bus$: BehaviorSubject<T>;

  stream: Observable<AllEventType>;

  questsLoadEvent$: Observable<Set<string>>;
  storesLoadEvent$: Observable<Set<string>>;

  constructor(initBus: T) {
    const initValue = initBus.getValue() as GroupedSubjects<AllEventType>;
    const _groupedStreams$ = new BehaviorSubject(initValue);

    super(_groupedStreams$);

    this.#bus$ = new BehaviorSubject(initBus);
    this.stream = this.#bus$.pipe(
      rxjs.switchMap(bus => bus.stream as Observable<AllEventType>)
    );

    this.#bus$.pipe(
      rxjs.skip(1),
      rxjs.switchMap(bus => bus.groupedStreams$ as Observable<GroupedSubjects<AllEventType>>),
      rxjs.share(),
    ).subscribe(this.groupedStreams$);

    this.questsLoadEvent$ = this.getEventStream(STORY_EVENTS.PASSAGES_LOAD).pipe(
      rxjs.map(R.pipe(
        R.prop('passages'),
        R.filter<Passage>(p => p.tags.includes(PASSAGE_TAGS.REACTIVE_QUEST)),
        R.map(R.prop('name'))
      )),
      rxjs.scan(
        (oldQuests, newQuests) => new Set([...oldQuests, ...newQuests]),
        new Set<string>()
      ),
      rxjs.shareReplay(1),
    );
    this.storesLoadEvent$ = this.getEventStream(STORY_EVENTS.PASSAGES_LOAD).pipe(
      rxjs.map(R.pipe(
        R.prop('passages'),
        R.filter<Passage>(p => p.tags.includes(PASSAGE_TAGS.REACTIVE_DATA_STORE)),
        R.map(R.prop('name'))
      )),
      rxjs.scan(
        (oldPassages, newPassages) => new Set([...oldPassages, ...newPassages]),
        new Set<string>()
      ),
      rxjs.shareReplay(1),
    );
  }

  getEventStream<N extends AllEventType['name']>(streamName: N) {
    return this.#bus$.pipe(
      rxjs.switchMap(bus$ => (
          Bus.prototype.getEventStream.call(bus$, streamName)
      ) as Observable<GetEventType<AllEventType, N>['payload']>)
    );
  }

  get statePath() {
    return this.#bus$.getValue().statePath;
  }

  emit<E extends IBusEvent = AllEventType>(event: E) {
    const bus$ = this.#bus$.getValue();
    return bus$.emit.call(bus$, event);
  }

  update(bus: T) {
    this.#bus$.next(bus);
  }
}




const setup = SugarCube.setup as (
  typeof SugarCube.setup &
  {
    eventStreams$: Bus<BusEvent>,
    EventStore: { StoreUpdateManager: StoreUpdateManager }
  }
);

export function handleThunkEventCalling() {
  setup.eventStreams$.persistent.stream
    .pipe(
      rxjs.filter(e => !!e.isAction),
      rxjs.map(ev => ({
        passage: Story.get(ev.name),
        context: ev.payload,
        errorContext: ev.errorContext,
      })),
    )
    .subscribe(({ passage, context, errorContext }) => {
      const restoreShadowStore = createShadowStore(
        State,
        { payload: context, ...context, }
      );
      try {
        Wikifier.wikifyEval(passage.text);
      }
      catch (e) {
        if (e instanceof Error && macroIsInDom(errorContext)) {
          const msg = `${e.message} in Passage ${passage.name}`;
          errorContext.error(msg);
        } else {
          throw e;
        }
      }
      finally {
        restoreShadowStore();
      }
    });
}

export function forwardStoreUpdateToState() {
  const state$ = rxjs.fromEvent($(document), ':passagestart').pipe(
    rxjs.map(() => {
      let storage = State.variables as Record<string, any>; 
      for (const attr of setup.eventStreams$.statePath) {
        if (!storage[attr]) {
          storage[attr] = {}
        }
        storage = storage[attr]
      }
      return storage;
    })
  );

  setup.eventStreams$.persistent.stream.pipe(
    rxjs.filter<IBusEvent>(ev => !ev.isEphemeral),
    rxjs.withLatestFrom(state$),
  ).subscribe(([_event, stateRoot]) => {
    const event = _event as BusStoreEvent;
    stateRoot[event.stateName] = event.payload;
  });
}

export function init(eventStoreStateKey?: string[]) {
  setup.eventStreams$ = new Bus(eventStoreStateKey || DEFAULT_EVENT_STORE_STATE_KEY);

  handleThunkEventCalling();
  forwardStoreUpdateToState();

  rxjs.fromEvent($(document), ':passageinit').subscribe(e => {
    setup.eventStreams$ = setup.eventStreams$.regenerate();
  });
  setup.eventStreams$.emit<LoadPassageEvent>({
    name: STORY_EVENTS.PASSAGES_LOAD,
    isAction: false,
    isEphemeral: true,
    payload: { passages: Story.filter(() => true) },
  });
  return setup.eventStreams$;
}

export function registerMacros(names = defaultMacroNames) {
  names = { ...defaultMacroNames, ...names }

  Macro.add(names.emit_event, {
    skipArgs : false,
    tags: null,
    handler: function () {
      let eventPayload;
      const script = (this.payload[0].contents).trim();
      if (script) {
        try {
          eventPayload = Scripting.evalTwineScript(`(${script})`);
        }
        catch (e) {
          if (e instanceof Error) {
            const msg = `${e.message}\n${script}`;
            this.error(msg);
          } else {
            this.error(JSON.stringify(e));
          }
        }          
      }

      setup.eventStreams$.emit({
        name: this.args[0].link,
        isAction: true,
        isEphemeral: true,
        payload: clone(eventPayload),
        errorContext: this,
      });
    },
  });

  Macro.add(names.reactive_store_default_value, {
    skipArgs: false,
    tags: [],
    handler() {
      if (!this.output.isConnected) {
        // not attached to Dom, probably is being called from store init
        // either way, it's ok to attach the node

        $(document.createElementNS(elementNS, 'default-store-value'))
          .hide()
          .data(DEFAULT_STORE_VALUE_GETTER_ATTR, () => {
            try {
              return Scripting.evalTwineScript(`(${this.payload[0].contents})`);
            }
            catch (e) {
              if (e instanceof Error) {
                this.error(e.message);
              } else {
                this.error(JSON.stringify(e));
              }
            }
          })
          .appendTo(this.output)
      }
    },
  });

  Macro.add(names.reactive_store_computed_values, {
    skipArgs: false,
    tags: [],
    handler() {
      if (!this.output.isConnected) {
        // not attached to Dom, probably is being called from store init
        // either way, it's ok to attach the node
        $(document.createElementNS(elementNS, 'store-pseudo-prototype'))
          .hide()
          .data(GET_STORE_PSEUDO_PROTOTYPE_KEY, () => (
            Scripting.evalTwineScript(`(${this.payload[0].contents})`)
          ))
          .appendTo(this.output)
      }
    },
  });

  Macro.add(names.access_store, {
    skipArgs : false,
    tags : [],
    handler() {
      const storeNames: string[] = this.args.map(p => p.isLink && p.link).filter(Boolean);
      setup.eventStreams$.updateStores(
        storeNames,
        draft => {
          const restoreShadowStore = injectVariables(State, draft);

          try {
            new Wikifier(this.output, this.payload[0].contents);
            for (const storeName of storeNames) {
              draft[storeName] = (State.variables as typeof draft)[storeName];
            }
          }
          finally {
            restoreShadowStore();
          }
        },
        this
      );
    }
  });
}

