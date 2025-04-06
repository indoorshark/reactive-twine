/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import * as rxjs from 'rxjs';
import type { Draft } from 'immer';

import { Quest } from "./reactive_quest.ts";
import type { IBaseQuestState } from "./reactive_quest.ts";
import {
  getStorePseudoPrototype,
  storeEnrichmentHandler,
} from "./misc.ts";
import type { IEventBus } from "./event_bus.ts";
import type { StoreUpdateManager } from "./store_update_manager.ts";


const { State } = SugarCube;
const setup = SugarCube.setup as (
  typeof SugarCube.setup &
  {
    eventStreams$: IEventBus,
    EventStore: { StoreUpdateManager: StoreUpdateManager }
  }
)

type BasicDraftContent = Record<string, unknown>;
type BasicDraft = Draft<Record<string, unknown>>;

abstract class StateVariableHandler<
  StoreNames extends string[] = string[],
  P extends undefined | ((input: BasicDraftContent) => BasicDraftContent) = undefined
> {

  storeNames = new Set<StoreNames[number]>()
  preprocessData?: P

  #grouped$Cache?: ReturnType<IEventBus['getValue']>
  protected _drafts: Map<StoreNames[number], [ BasicDraft, BasicDraft, number ]> = new Map();

  getStoreValue(storeName: StoreNames[number]) {
    if (!this.#grouped$Cache) {
      this.#grouped$Cache = setup.eventStreams$.getValue();
    }
    return setup.eventStreams$._getStoreValue(
      storeName,
      this.#grouped$Cache as any
    );
  }

  #pseudoPrototypes = new Map();

  #getPseudoPrototypes(storeName: StoreNames[number]) {
    if (!this.#pseudoPrototypes.has(storeName)) {
      const pseudoPrototype = getStorePseudoPrototype(storeName);
      this.#pseudoPrototypes.set(storeName, pseudoPrototype);
    }
    return this.#pseudoPrototypes.get(storeName)
  }

  protected _addEnrichedDraft(storeName: StoreNames[number]) {
    let currentValue = this.getStoreValue(storeName);
    if (this.preprocessData) currentValue = this.preprocessData(currentValue);
    const [draftId, draft] = setup.EventStore.StoreUpdateManager.createDraft(
      storeName,
      currentValue
    );
    const pseudoPrototype = this.#getPseudoPrototypes(storeName);
    const proxyHandler = Object.create(
      storeEnrichmentHandler,
      { targetPrototype: { value: pseudoPrototype } }
    )
    const enrichedDraft = new Proxy(draft, proxyHandler);
    this._drafts.set(storeName, [ enrichedDraft, draft, draftId ]);
  }

  pickUpChangesAndReset(root: Record<StoreNames[number], BasicDraftContent | BasicDraft>) {
    for (const [storeName, [enrichedDraft, draft, draftId]] of this._drafts) {
      const pseudoPrototype = this.#getPseudoPrototypes(storeName);
      let newValue: BasicDraftContent | BasicDraft;

      if (root[storeName] !== enrichedDraft) {
        // i.e. <<set $MyStore = { some: "value" }>>
        newValue = root[storeName];
      } else {
        newValue = draft;
      }

      if (Config.debug) {
        for (const attr in pseudoPrototype) {
          // if (!newValue || (attr in newValue)) {
          if (!newValue || Object.prototype.hasOwnProperty.call(newValue, attr)) {
            // we could have check and run the setter if there is one
            // but that sound weird either way, let's just not
            const msg = `Attempting to assign a store using a computed attribute: "${attr}"`;
            throw new Error(msg);
          }
        }
      }

      setup.EventStore.StoreUpdateManager.commit(draftId, newValue);
    }

    this.reset();
  }

  reset() {
    this._drafts.clear();
    this.#grouped$Cache = undefined;
    // we actually don't want to reset descriptors
    // it is made to pickup data from other attribute
    // this.#_descriptors
  }
}

class StateVariableRootStoresHandler extends StateVariableHandler {
  // isDescriptors = true;

  #_descriptors?: { [name: string]: PropertyDescriptor };

  addStores(newStores: Set<string>) {
    this.storeNames = new Set([...this.storeNames, ...newStores]);
    this.#_descriptors = Object.assign({}, this.#_descriptors || {});
    for (const storeName of newStores) {
      this.#_descriptors[storeName] =  {
        get: () => {
          if (!this._drafts.has(storeName)) {
            this._addEnrichedDraft(storeName)
          }
          return this._drafts.get(storeName)![0];
        },
        set(this: typeof State['variables'], value: any) {
          delete this[storeName as keyof typeof State['variables']];
          Reflect.set(this, storeName, value)
        },
        enumerable: false,
        configurable: true,
      }
    }
  }

  get descriptors() { return this.#_descriptors }
}
class StateVariableQuestHandler extends StateVariableHandler<
  string[],
  (input: BasicDraftContent) => BasicDraftContent
> {
  // isProxy = true;

  #_proxy?: Record<string, typeof Quest['initialState']>;

  addQuests(newQuests: Set<string>) {
    this.storeNames = new Set([...this.storeNames, ...newQuests]);
    // the proxy will read this.storeNames by reference
    // and will work with latest value when proxy `get` is called
  }

  get proxy() {
    if (this.#_proxy) return this.#_proxy;
    return this.#_proxy = new Proxy(
      {},
      {
        get: (_target, propName: string, _recv) => {
          const storeName = propName;

          if (this._drafts.has(propName)) {
            return this._drafts.get(storeName)![0];

          } else if (this.storeNames.has(propName)) {
            this._addEnrichedDraft(storeName);
            return this._drafts.get(storeName)![0];

          } else {
            return undefined;
          }
        },
        set(_target, _propName, _value) {
          throw new Error(
            "Directly assigning to a reactive quest is not supported"
          );
        },
      }
    )
  }
}

export function setupTransparentStoreAccess() {

  const stateVariableHandler = new StateVariableRootStoresHandler();
  const questStateHandler = new StateVariableQuestHandler();
  questStateHandler.preprocessData = (questStore: BasicDraftContent) => {
    if (!questStore.status) {
      return {
        ...Quest.initialState,
        ...questStore,
      };
    } else {
      return questStore;
    } 
  }

  setup.eventStreams$.persistent.storesLoadEvent$.subscribe(
    (newStores) => {
      stateVariableHandler.addStores(newStores);
    }
  );
  setup.eventStreams$.persistent.questsLoadEvent$.subscribe(
    (newQuests) => {
      questStateHandler.addQuests(newQuests);
    }
  );

  type EnrichedVariables = (
    Record<string, unknown> &
    { ReactiveQuest?: Record<string, IBaseQuestState> }
  )

  const handlers$ = rxjs.fromEvent($(document), ':passagestart').pipe(
    rxjs.map(() => {
      // make sure no edits happen between
      // last run and now
      stateVariableHandler.reset();
      questStateHandler.reset();

      Object.defineProperties(
        State.variables,
        // TODO: it's possible to have passagestart called before
        // stateVariableHandler.addStores called?
        stateVariableHandler.descriptors!
      );
      Object.defineProperty(
        State.variables,
        'ReactiveQuest',
        {
          value: questStateHandler.proxy,
          configurable: true,
        }
      );
      return [
        stateVariableHandler,
        questStateHandler,
        State.variables as EnrichedVariables,
      ] as const;
    }),
  );
  rxjs.fromEvent($(document), ':passagerender').pipe(
    rxjs.zipWith(handlers$)
  ).subscribe({
    next([_, [variableHandler, questHandler, State_Variables]]) {
      variableHandler.pickUpChangesAndReset(State_Variables as any);
      questHandler.pickUpChangesAndReset(State_Variables.ReactiveQuest! as any);
      for (const name of variableHandler.storeNames) {
        delete State_Variables[name];
      }
      delete State_Variables['ReactiveQuest'];
    },
    error(error) {
      console.error(error);
      throw error;
    },
  });

}
