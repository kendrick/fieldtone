# Listening test 0001: does Recognition land?

FieldTone is built around one Moment. A listener makes a sound, and a few seconds later hears it come back through Ember's Reverb, changed but still theirs. #22 shipped a deliberately thin version of it to answer one question, and this is the test that answers it.

Run this after #28 merges. Record the result in the Results section below, then close #30 with a pointer to it.

## Why it is a listening test and not a unit test

Principle VIII allows manual experiential testing for subjective audio quality, and nothing automated can answer this one. The unit suite proves the ring buffer stays inside four seconds and that the fragment carries the attack. An offline render proves the Material reaches the Reverb and is audible. None of that says whether a person hears their own sound come back and feels anything.

ADR 0003 set the house shape for a test like this: a fixed number of sessions across varied environments, a tally, and a threshold written down before the run. Follow it.

## What counts as a pass

Write the judgment before you start, so a disappointing run cannot be argued into a passing one.

**Recognition lands if more than half of all re-injections across the whole run are judged _mine_, and at least a third of every environment's re-injections are judged _mine_.**

The second half matters as much as the first. A feature that works beautifully in a quiet room and fails everywhere else is a finding, not a success, and an average would hide it. A floor of merely nonzero would not catch that feature either. Forty-for-forty in a quiet room and four-for-twenty in each of three others clears nonzero and clears the overall half at 52%. It also fails four times out of five in every room that is not quiet.

The per-environment third is coarse, and deliberately so. Ten sessions across four environments leaves the thinner environments around twenty re-injections each. A third of twenty is about seven, so one judgment moves the figure five points. That is the price of a session count that can be read against ADR 0003's. This test is a go/no-go on Spectral Listening (#29), not a measurement of how well Recognition does room by room. A finer figure would need a longer run, and it would answer a question nobody is asking yet.

**intrusive** stays out of the pass condition. Whether Recognition lands and whether the fragment arrives gracefully are separate questions, and this test exists to answer the first. Record the rate anyway, because a high one argues for a shorter fragment or a quieter one.

## Judging a re-injection

Record two things about each one: which recognition judgment it earned, and which flags apply. Both come from `CONTEXT.md`. Recognition is hearing a sound "come back changed but still identifiably theirs", and a Moment is "a perceptible event in a Scene that catches attention without demanding it". The judgment says which clause of Recognition held. The flags say which clause of the Moment did.

### The recognition judgment

Exactly one, and only for a re-injection you noticed.

| Judgment     | What it means                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **mine**     | You recognized the sound as yours, it had changed, and it belonged in the music.                                       |
| **replayed** | You recognized it, but it read as a recording played at you rather than part of the Scene. It failed to change enough. |
| **noise**    | You did not recognize it, or it read as unrelated sound. It changed too much, or it caught the wrong thing.            |

A re-injection you never noticed until you checked is **missed**. It takes no judgment and no flags, because you cannot say what came back if you never heard it.

### The two flags

Independent of the judgment and of each other. Either can ride a **mine**.

| Flag           | What it means                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **intrusive**  | It demanded attention rather than catching it. It startled, or it was too loud.                                      |
| **mechanical** | What came back was steady mechanical sound—traffic, HVAC, an engine—rather than transient human or incidental sound. |

These are flags rather than judgments because neither one tells you anything about recognition. A fragment can be plainly yours and still too loud, and an unrecognizable one may or may not be mechanical. Folding a flag back into the judgment forces a coin-flip on every fragment that is both. That coin-flip lands in the tally that decides what to build next.

**mechanical** in particular has to ride every re-injection you heard. ADR 0003's revisit gate counts steady mechanical sound against all re-injected fragments, not against the ones you failed to recognize. A count nested inside **noise** cannot be read against that gate at all.

Only **mine** passes. **replayed** and **noise** fail different clauses of Recognition, and **missed** and **intrusive** fail different clauses of the Moment. Which of them dominates decides what to do next, so resist collapsing them.

## Sessions

**Ten sessions, five minutes each, across at least four environments.** The count and length follow ADR 0003 so the two tests can be read against each other.

Cover at least these four, and note any others:

- a quiet room, the easy case
- a room with steady mechanical sound: HVAC, a fan, traffic through a window
- a room with other people talking
- outdoors

Run at least two sessions in every environment, so the per-environment floor has enough re-injections to measure. Two apiece is the floor, so ten sessions cover four or five environments and no more. The quiet room still carries extra weight. If Recognition does not land there, nothing about the other environments matters.

## Running one session

1. Open FieldTone, press play, and let the Bed settle until the Invitation to let it listen appears. It waits twenty seconds the first time and arrives at once on every visit after that.
2. Accept the Invitation to let it listen.
3. Over five minutes, make roughly ten deliberate sounds, spaced far enough apart that each re-injection finishes before the next sound. A capture takes four seconds to fill, so leave at least fifteen seconds between them.
4. Vary the sound. Use a clap, a spoken word, a whistle, a knock on the desk, and a set of keys. A run of ten claps tests one transient ten times.
5. After each one, wait, listen, and record a judgment. Record **missed** honestly rather than replaying the moment in your head until you decide you heard it.
6. On every re-injection you heard, set or clear both flags. Flag **mechanical** on all of them, not only on the ones you failed to recognize. Every fragment you heard is the denominator ADR 0003's revisit gate uses.
7. Note the environment, the wall-clock length, and anything the tally cannot carry.

Use headphones for at least half the sessions and speakers for the rest, and record which. Echo cancellation is off, so a speaker puts the Bed into the microphone, and whether that changes the result is worth knowing.

## What this test cannot show

You know what you are testing and you know when you made a sound, so you cannot be surprised the way a first-time listener would be. That biases every judgment toward **mine** and away from **missed**. Treat a **missed** as strong evidence and a **mine** as weaker.

It also says nothing about whether a listener who was not told about Recognition would ever notice it. That is a different question and it needs different people.

## Results

_Fill in when the test is run. Leave it empty until then rather than sketching a shape for it._

**Run on:**
**Build:**
**Ran by:**

| Session | Environment | Output | mine | replayed | noise | missed | intrusive | mechanical |
| ------- | ----------- | ------ | ---- | -------- | ----- | ------ | --------- | ---------- |

The last two columns are flags. They overlap the first four and do not sum with them.

**Total re-injections:**
**Judged _mine_, and as a share of the total:**
**Lowest per-environment _mine_ rate, and which environment:**
**Flagged _intrusive_:**
**Flagged _mechanical_, against the re-injections you heard (total minus _missed_):**

**Does Recognition land?**

_Answer yes or no in a sentence. Describe what happened afterward, not instead._

## If it fails

A failure here is a finding worth writing up, not a defect to patch quietly. Record it as an ADR, and say what it implies for each of these:

- **Fragment length.** Four seconds is a starting point that #28 chose without evidence and its non-goals explicitly deferred. A run dominated by **replayed**, or one where **intrusive** rides a large share of the re-injections, is the evidence that would move it.
- **Spectral Listening (#29).** #22 argues Level Listening is enough to answer whether a Scene responding to a room feels like anything, and that this answer decides whether deeper analysis earns its cost. A run dominated by **noise** is the argument for buying it.
- **ADR 0003's revisit gate.** That ADR will only reopen semantic listening once more than half of re-injected fragments are steady mechanical sound rather than transient human sound, and only after cheaper tuning has been tried and demonstrably capped out. The **mechanical** flag's share of the re-injections you heard is the first measurement against condition 1. The **missed** ones sit outside that share, so record how many there were. Nothing here can satisfy condition 2, which needs a tuning pass that has not happened.

Changing the implementation in response to a poor result is separate work. Record the finding here first.
