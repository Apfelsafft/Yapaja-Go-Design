/**
 * The Core widget registry (E07-T1): all ten widgets the task requires,
 * registered once at module load. Add-on-registered widgets (docs/05
 * Section 4, E09) will register into a `WidgetRegistry` the same way --
 * this module is just the CORE catalogue's registration point, not the
 * registry mechanism itself (that's `@yapaja/ui`'s `WidgetRegistry` class).
 */

import { WidgetRegistry } from '@yapaja/ui';
import { speedWidget } from './speed.js';
import { speedLimitWidget } from './speedLimit.js';
import { etaWidget } from './eta.js';
import { distanceWidget } from './distance.js';
import { timeWidget } from './time.js';
import { altitudeWidget } from './altitude.js';
import { clockWidget } from './clock.js';
import { compassWidget } from './compass.js';
import { nextInstructionWidget } from './nextInstruction.js';
import { gpsStatusWidget } from './gpsStatus.js';

export const shellWidgetRegistry = new WidgetRegistry();

for (const widget of [
  speedWidget,
  speedLimitWidget,
  etaWidget,
  distanceWidget,
  timeWidget,
  altitudeWidget,
  clockWidget,
  compassWidget,
  nextInstructionWidget,
  gpsStatusWidget,
]) {
  shellWidgetRegistry.register(widget);
}
