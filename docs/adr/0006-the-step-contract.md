# The store holds the value, the slider shows the nearest one it can

A range input can only display `min + n * step`. The store, the audio graph and a serialized link can hold any double. When those disagree, the store wins and the slider is understood to be lossy. `step` is a control concern and nothing else.

Nothing in the code changes because of this. The split is already there, and it was already deliberate; what was missing is any record of why, which is what makes it read as a bug every time someone new finds it.

## What the disagreement looks like

Ember's grid is `0.01`. A link carrying `?space=0.352` restores 0.352 to the store, plays 0.352, and hands 0.352 back to the next link. The slider shows 0.35, because 0.352 is not a position it has. Codex raised this on PR #51 and was right about the mechanism.

The error is bounded at half a step, which is 0.005 on both of Ember's parameters. It is a display that rounds, not a value that drifts. Nothing downstream ever reads the rounded number, and dragging the slider replaces the stored value outright rather than nudging it.

## Why the slider does not win instead

Ticket #36 measured three ways to make the slider tell the whole truth. Each costs more than the rounding does.

Fitting each parameter's grid to the values it used to produce is cheaper than it looks and still not worth it. The old step was a hundredth of the range, computed per parameter, so Space moved in 0.008 and Brightness in 0.0225. The coarsest step that keeps those increments and the default on one grid is 0.002 for Space and 0.0025 for Brightness, which leaves 400 positions and 900. That is five times the presses to cross Space and four times to cross Brightness, bought to let the slider display values the store already keeps exactly.

Ticket #56 records this alternative as a single 0.0005 grid costing 1600 presses and 4500. That is the price of holding both parameters to one step, and nothing asks for it, because each parameter declares its own.

Dropping the grid with `step="any"` displays any value and breaks the keyboard in the other direction. Measured on Firefox, one arrow press moves Brightness a full 1.0 of its 2.25 range and Space 0.45 of its 0.8. Chromium and WebKit scale their increment with the range, so the failure is not even consistent across engines.

Snapping the value to the grid on the way in puts `0.35000000000000003` into the next link, because the quantized product is not the double the listener started with. #36 verified this by making the runtime do it. `tests/integration/shared-link.spec.ts` carries the case that fails if anyone lands this, and that test is the pin holding this decision in place.

A numeric readout beside each slider would show the played value without touching any of this. #36 rejected it as hiding the defect rather than fixing it, and #56 keeps it out of scope. It stays available to a Scene that wants it.

## What a Scene author has to do

Declare a `step` on every parameter, and make it divide the range between 50 and 500 ways with the default and the max both landing on it.

That is the whole rule. Ember already follows it, and the comment above `emberParameters` already tells authors to, so this writes down a habit rather than introducing one. Space divides 80 ways and Brightness 225.

## DEFAULT_STEP keeps its 0.01 and gains a bound

`resolveStep` falls back to `DEFAULT_STEP` when a parameter declares no step. No real Scene reaches that path today, since both of Ember's parameters spell their step out; only the inline schema fixtures in the specs rely on it.

The fallback is still worth keeping, because a fixture that renders nothing should not have to invent a grid. What it is missing is an opinion about how many positions it leaves. A parameter ranging 0 to 1000 on the default step gets 100,000 of them and a keyboard nobody can use, and nothing currently notices.

So `resolveStep` gains a position count check beside the two it already makes. Below 50 positions a slider is too coarse to be worth the arrow keys, which is the floor `src/scenes/ember/parameters.spec.ts` already asserts and the one number here that was measured. The ceiling of 500 is a judgment rather than a measurement. It sits roughly where holding an arrow key stops being a way to cross a range, and the first Scene with a good reason should widen it.

Throwing rather than silently substituting a better step follows what `resolveStep` already does with a step that is not finite, and what `assertOnStepGrid` does with a bound off its own grid. A Scene whose schema is wrong fails the moment anything reads it, rather than at a listener's slider.

## Consequences

The slider can show a number the Scene is not playing, by up to half a step, and that is now a documented property rather than an open defect. Anyone who finds it again should find this file.

`step` may be changed for usability alone, with no thought given to what the store holds, because the store does not care. That is the point of settling which side gives.

The position check is not written yet. #56 is a spike and produces findings rather than code, so the implementation is its own issue, along with the fixture pass that a new throw will need.

Nothing here reopens `0.01` as Ember's step. It satisfies #36, both ranges land on it, and both are comfortably inside the bound above.
