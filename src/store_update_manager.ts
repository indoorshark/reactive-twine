/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import { fromEvent } from 'rxjs';
import * as immer from 'immer';
import type { Draft, Objectish, Patch } from 'immer';
import { equals } from 'ramda';

import type { IEventBus } from './event_bus.ts';

const setup = SugarCube.setup as (
  typeof SugarCube.setup &
  {
    eventStreams$: IEventBus,
    EventStore: { StoreUpdateManager: StoreUpdateManager }
  }
);



export class StoreUpdateManager<StoreName extends string = string> {
  idCounter = 0;
  registry = new Map<StoreName, Map<number, Draft<Record<string, unknown>>>>();
  idToStoreNameMap = new Map<number, StoreName>();

  registerNewDraft(storeName: StoreName, _currentValue: Objectish, draft: Draft<Record<string, unknown>>) {
    const id = ++this.idCounter;
    if (!this.registry.has(storeName)) {
      this.registry.set(storeName, new Map());
    }
    this.registry.get(storeName)!.set(id, draft);
    this.idToStoreNameMap.set(id, storeName);
    return id;
  }

  createDraft(storeName: StoreName, currentValue: Record<string, unknown>) {
    const draft = immer.createDraft(currentValue);
    const draftId = this.registerNewDraft(storeName, currentValue, draft);
    // this.inheritedChanges.set(draftId, []);
    return [draftId, draft] as const;
  }

  update(storeName: StoreName, cb: (draft: Draft<Record<string, unknown>>) => void) {
    const oldValue = setup.eventStreams$.getStoreValue(storeName);
    const [id, draft] = this.createDraft(storeName, oldValue);
    cb(draft);
    this.commit(id, draft);
  }

  commit(draftId: number, draftOrNewValue: Record<string, unknown> | Draft<Record<string, unknown>>) {
    let changes: Patch[] = [];
    let newStoreValue: Record<string, unknown>;
    if (!immer.isDraft(draftOrNewValue)) {
      newStoreValue = clone(draftOrNewValue);
      changes = [{
        op: 'replace',
        path: [],
        value: newStoreValue
      }];
    } else {
      newStoreValue = immer.finishDraft(
        draftOrNewValue,
        (_patches) => { changes = _patches; }
      );
    }
    const storeName = this.idToStoreNameMap.get(draftId)!;
    // this registry cleanup is placed before the apply inheritedChanges loop
    // so that we don't have to filter out itself
    this.registry.get(storeName)!.delete(draftId);

    if (changes.length <= 0) {
      return;
    } else if (this.storeEquals(storeName, newStoreValue)) {
      // no change === don't need to emit
    } else {
      for (const [_thatId, thatDraft] of this.registry.get(storeName)!) {
        immer.applyPatches(thatDraft, changes);
        // this.inheritedChanges.get(thatId).push(changes);
      }
      setup.eventStreams$.emit({
        name: `${storeName}StoreUpdate`,
        payload: newStoreValue,
        isEphemeral: false,
        stateName: storeName,
      });
    }

    // this.inheritedChanges.delete(draftId);
    this.idToStoreNameMap.delete(draftId);
  }

  storeEquals(storeName: string, proposedValue: unknown) {
    const atmStoreValue = setup.eventStreams$.getStoreValue(storeName);
    return equals(proposedValue, atmStoreValue);
  }
};

function createAndKeptFreashStoreUpdateManager() {

  fromEvent($(document), ':passageinit').subscribe(() => {
    if (!setup.EventStore) setup.EventStore = {} as any;
    setup.EventStore.StoreUpdateManager = new StoreUpdateManager();
  });

}

export function init() {
  createAndKeptFreashStoreUpdateManager();
}
