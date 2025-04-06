/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import * as rxjs from 'rxjs';
import { Subscription, Observable } from 'rxjs';
import { createDraft, finishDraft } from 'immer';

import { EventType } from '../event_bus.ts';
import type { IEventBus } from '../event_bus.ts';

import {
  injectVariables,
  createShadowStore,
} from "../misc.ts";

const { State } = SugarCube;
const setup = SugarCube.setup as (
  typeof SugarCube.setup &
  {
    eventStreams$: IEventBus,
  }
);

interface INames {
  do_when_changed: string;
  liveEventDisplayElementTag: string;
}

export function registerMacro(names: INames) {

  class LiveEventDisplay extends HTMLElement {
    subscription?: Subscription;
    connectedCallbacks : ((this: LiveEventDisplay) => void)[] = [];
    disconnectedCallbacks : ((this: LiveEventDisplay) => void)[] = [];

    connectedCallback() {
      for (const cb of this.connectedCallbacks) cb.call(this);
    }

    disconnectedCallback() {
      for (const cb of this.disconnectedCallbacks) cb.call(this);
    }
  }
  window.customElements.define(names.liveEventDisplayElementTag, LiveEventDisplay);

  Macro.add(names.do_when_changed, {
    skipArgs : false,
    tags : [],
    handler() {
      const storeSource : string[] = [];
      const basicEventSource : string[] = [];
      for (const source of this.args) { 
        const sourceName = (source?.isLink ? source.link : source);
        switch (EventType.resolveByName(sourceName)) {
        case EventType.STORE_UPDATE:
          storeSource.push(sourceName);
          break
        default:
          basicEventSource.push(sourceName);
          break
        }
      }

      const storesUpdates$ = rxjs.combineLatest(
        storeSource.map(
          n => setup.eventStreams$.getStoreUpdateStream(n)
        )
      ).pipe(
        rxjs.startWith(storeSource.map(
          n => setup.eventStreams$.getStoreValue(n)
        )),
        rxjs.map(stores => Object.fromEntries(
          storeSource.map((name, idx) => [name, stores[idx]])
        )),
        rxjs.shareReplay(1),
      );
      const mergedBasicEvents$ = rxjs.merge(
        ...basicEventSource.map(
          name => setup.eventStreams$.getEventStream(name).pipe(
            rxjs.map(ev => ({ [name]: ev }))
          )
        ),
      ).pipe(
        rxjs.map(events => ({
          ...Object.fromEntries(basicEventSource.map(n => [n, null])),
          ...events,
        }))
      );

      const containerElem = (
        document.createElement(names.liveEventDisplayElementTag)
      ) as LiveEventDisplay;
      this.output.append(containerElem);

      type E = (typeof mergedBasicEvents$) extends Observable<infer T> ? T : never;
      type S = (typeof storesUpdates$) extends Observable<infer T> ? T : never;
      let input$ : Observable<[E, S]>;
      if (storeSource.length > 0) {
        // no stores storesUpdates$ would still startWith({}),
        // causing an extre call at the beginning
        // with no event, the script might not expect this
        input$ = mergedBasicEvents$.pipe(
          rxjs.mergeWith(storesUpdates$.pipe(rxjs.mapTo({}))),
          rxjs.withLatestFrom(storesUpdates$),
        );
      } else {
        input$ = mergedBasicEvents$.pipe(
          rxjs.map(ev => [ev, {}])
        )
      }

      // opt to use animation frame than simple throttle
      // input$ = input$.pipe(
      //   rxjs.buffer(
      //     input$.pipe(rxjs.throttleTime(Engine.DOM_DELAY))
      //   ),
      //   rxjs.map(events => Object.assign(
      //     {}, // incase events is empty array
      //     ...events
      //   )),
      // )

      const contents = this.payload[0].contents;
      const macroContext = this;

      containerElem.connectedCallbacks.push(function (this: typeof containerElem) {
        if (this.subscription) return;
        this.subscription = input$.pipe(
          rxjs.map(([basicEventsObj, stores]) => {
            let result, oldStore;
            if (Config.debug) {
              oldStore = stores;
              stores = createDraft(stores);
            }
            const restoreShadowStores = [
              injectVariables(State, stores),
              createShadowStore(State, basicEventsObj)
            ];
            try {
              result = Wikifier.wikifyEval(contents);
            }
            finally {
              for (const restore of restoreShadowStores) restore();
            }
            if (Config.debug) {
              const newStores = finishDraft(stores)
              if (newStores !== oldStore) {
                const msg = (
                  "Don't update the do_when_changed's dependency directly in it's own body!\n " +
                  "It is a risky path that easily mislead one to infinite loop. " +
                  `However, if you really wanted to, you can try using a <<access_store [[StoreName]]>> macro, ` +
                  "or using an additional action."
                );
                macroContext.error(msg);
              }
            }
            return result;
          }),
          // so the script will ran on every event, but
          // only attach to dom at most once every frame
          rxjs.throttleTime(
            0,
            rxjs.animationFrameScheduler,
            { leading: true, trailing: true }
          ),
        ).subscribe({
          next(fragment) {
            containerElem.innerHTML = '';
            containerElem.append(fragment);
          },
          error: console.error
        });
      });
      containerElem.disconnectedCallbacks.push(function (this: typeof containerElem) {
        if (this.subscription) this.subscription.unsubscribe();
        this.subscription = undefined;
      });
    }
  });

}

