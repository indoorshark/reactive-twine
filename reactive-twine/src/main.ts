/**!
  * This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at https://mozilla.org/MPL/2.0/.
  */

import * as immer from 'immer';

import { init as initEventBus, registerMacros as registerEventMacros } from './event_bus.ts';
import { init as initStoreUpdateManager } from './store_update_manager.ts';
import { init as initReactiveQuest, QuestStore, registerMacros as registerQuestMacros } from './reactive_quest.ts';
import { setupTransparentStoreAccess } from './transparent_store_access.ts';
import { registerMacros as registerExtraMacros } from "./macros";

immer.enablePatches();
immer.enableMapSet();

initEventBus();
registerEventMacros();

initStoreUpdateManager();

const questStore = new QuestStore();
registerQuestMacros(questStore);
initReactiveQuest(questStore);

setupTransparentStoreAccess();

registerExtraMacros();

