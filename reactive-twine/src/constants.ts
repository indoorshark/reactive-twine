/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

export const baseElementNS = `refreshingjunk.itch.io`;

export const DEFAULT_EVENT_STORE_STATE_KEY = ['EventStore'];

export enum STORY_EVENTS {
  PASSAGES_LOAD = 'reactive-twine/passages-load',
}

export enum PASSAGE_TAGS {
  REACTIVE_QUEST = 'reactive-quest',
  REACTIVE_DATA_STORE = 'reactive-data-store',
}

export const GET_STORE_PSEUDO_PROTOTYPE_KEY = 'getStorePseudoPrototype';

export const defaultMacroNames = {
  // event bus
  emit_event: 'emit_event',
  reactive_store_default_value: 'reactive_store_default_value',
  reactive_store_computed_values: 'reactive_store_computed_values',
  access_store: 'access_store',


  // reactive quest
  reactive_quest: 'reactive_quest',
  quest_line: 'quest_line',
  qeust_update_depends_on: 'qeust_update_depends_on',
  quest_log: 'quest_log',
  questPassingAttr: 'reactiveQuest',

  quest_progress_to: 'quest_progress_to',
  quest_complete: 'quest_complete',
  quest_botch: 'quest_botch',
  quest_unbotch: 'quest_unbotch',
  quest_mention: 'quest_mention',


  // do when changed
  do_when_changed: 'do_when_changed',
  liveEventDisplayElementTag: 'reactive-twine-live-event-display-container',
};

