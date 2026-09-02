# Backgrounding on iOS: What the Platform Actually Does

Research notes for issue #13. Every claim below is traced to a spec, to WebKit's own source or bug tracker, or to Apple's developer documentation. Where the only evidence is a bug reporter's word, it says so.

Read as of 2 September 2026. WebKit source references are to `main` at that date; a permalink would be better but the file paths move, so the quoted text is the thing to trust.

## 1. What the Audio Session Spec Says

**Answer.** The spec defines `play-and-record` and `playback` by intent, not by background behavior. It says nothing at all about backgrounding, page visibility, or screen lock. It does define a way for a page to hear about interruptions, `state` plus a `statechange` event, but Safari does not ship it (see §2). One clause matters more to FieldTone than any of that: under `auto` or an explicit type, a microphone track is **ended** by the user agent if the session type is anything other than `play-and-record` or `auto`.

Sources: [Editor's Draft](https://w3c.github.io/audio-session/) (repo HEAD, `index.bs` last touched 25 March 2025), published as a [W3C Working Draft dated 13 November 2024](https://www.w3.org/TR/audio-session/). Editors: Youenn Fablet (Apple), Alastor Wu (Mozilla).

### The Two Types

> **playback**
> Playback audio, which is used for video or music playback, podcasts, etc. They should not mix with other playback audio. (Maybe) they should pause all other audio indefinitely.

> **play-and-record**
> Play and record audio, which is used for recording audio. This is useful in cases microphone is being used or in video conferencing applications.

Both are what the spec calls an _exclusive type_:

> An `AudioSessionType` is an **exclusive type** if it is `playback`, `play-and-record` or `transient-solo`.

That is the whole normative difference. Neither definition mentions the background.

### Backgrounding

Nothing. Grepping the Editor's Draft for `background`, `hidden`, `visib`, and `screen lock` returns zero hits. The Privacy and Security sections are empty headings. Whatever `playback` does when the screen locks is a user-agent decision the spec declines to constrain.

### Interruptions

The spec models interruption as a session state, and puts an example in normative-adjacent prose:

> An active `playback` audio session can be interrupted by an incoming phone call, or by another `playback` session that is going to start playing a new media content in another tab.

The state machine:

> **active**: the audio session is playing sound or recording microphone.
> **interrupted**: the audio session is not playing sound nor recording microphone, but can resume when it will get uninterrupted.
> **inactive**: the audio session is not playing sound nor recording microphone.

State changes can arrive from outside the page, and the UA must report them:

> Conversely, an audio session state can be modified outside of audio session element changes. When the user agent observes such a modification, the user agent MUST queue a task to notify the state's change with |audioSession| [...]

and the last step of _notify the state's change_ is:

> Fire an event named statechange at |audioSession|.

So the spec's answer to "how does a page hear about an interruption" is `navigator.audioSession.state` plus `onstatechange`. Safari ships neither (§2).

### The Clause That Decides FieldTone's Design

The spec makes a microphone `MediaStreamTrack` an audio session _element_ whose default type is `play-and-record`, and gives it these update steps:

> - Its **element update steps** are:
>   1. Let |track| be the `MediaStreamTrack` object.
>   2. Let |audioSession| be |track|'s `AudioSession`.
>   3. If |audioSession|.[[type]] is not `play-and-record` or `auto`, **end** |track|.

Read that against the app as it stands. FieldTone sets `type = 'playback'`. A conforming implementation would end any microphone track the page holds. The suspend and resume steps for the same element are gentler—they set the track's muted state to `true` and back—but they only run on interruption, not on a type mismatch.

The spec also gives `AudioContext` a default type of `ambient`, and defines its interruption behavior by delegation to Web Audio:

> - Its **element suspend steps** are: [...] Queue a control message to interrupt |audioContext|.
> - Its **element resume steps** are: [...] Queue a control message to end the |audioContext|'s interruption.

Those hooks are real and Safari implements them—see §2 on `AudioContextState`.

## 2. What WebKit Actually Implements

**Answer, in order of usefulness:**

1. **`play-and-record` keeps background playback.** WebKit's override for the background-playback restriction accepts `playback` and `play-and-record` identically. Switching FieldTone's session type would not cost the background audio the app gets today.
2. **But `playback` costs you the microphone.** Setting the type installs a category override that pins the process's `AVAudioSession` to `AVAudioSessionCategoryPlayback`, and that override outranks the capture-driven category. There is no input on `Playback`. If FieldTone wants the mic, `playback` has to go.
3. **`play-and-record` is not free.** WebKit forces `AVAudioSessionMode.videoChat` alongside it, which Apple documents as retuning the device's EQ for voice and narrowing the allowed routes.
4. **`navigator.audioSession.type` shipped in Safari 16.4 (27 March 2023). `state` and `onstatechange` have never shipped.**
5. **Background Web Audio for `playback` did not exist in 16.4.** It landed on 1 March 2024 and appears to have reached users in iOS 17.5.

### Which Version, and What Subset

The [WebKit Features in Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/) post (27 March 2023) lists, under media features:

> Support for a subset of the AudioSession Web API

The subset is spelled out in the commit that enabled it, [`c393587`](https://github.com/WebKit/WebKit/commit/c39358705b79ccf2da3b76a8be6334e7e3dfcfa6), titled _Enable AudioSession Web API by default, but only a reduced subset_ ([bug 250764](https://bugs.webkit.org/show_bug.cgi?id=250764)): `navigator.audioSession` and `.type` on, `state` and `onstatechange` behind a flag.

That is still true. `Source/WebCore/Modules/audiosession/DOMAudioSession.idl`:

```webidl
] interface DOMAudioSession : EventTarget {
    attribute DOMAudioSessionType type;

    [EnabledBySetting=DOMAudioSessionFullEnabled] readonly attribute DOMAudioSessionState state;
    [EnabledBySetting=DOMAudioSessionFullEnabled] attribute EventHandler onstatechange;
};
```

and `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` gives `DOMAudioSessionFullEnabled` `status: testable` with `default: false` for WebKit, WebKitLegacy and WebCore alike, while `DOMAudioSessionEnabled` is `status: mature`, default true. [MDN's browser-compat data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json) agrees independently: `AudioSession` and `AudioSession.type` are `16.4`; `AudioSession.state` and `AudioSession.statechange_event` are `false`, with `safari_ios` mirroring Safari.

**So there is no interruption event on `navigator.audioSession` in any shipping Safari.** What does work is Web Audio's own: WebKit's `Source/WebCore/Modules/webaudio/AudioContextState.idl` declares

```webidl
enum AudioContextState {
    "suspended",
    "running",
    "interrupted",
    "closed"
};
```

ungated, and `AudioContext::suspendPlayback` sets `State::Interrupted` when the platform session is interrupted, which fires `statechange` on the context. Blame puts that fourth enum value in the file since `aa9f456` (18 June 2020), well before the 16.4 floor. The [Web Audio Editor's Draft](https://webaudio.github.io/web-audio-api/#dom-audiocontextstate-interrupted) defines `interrupted` as "This context is currently interrupted and cannot process audio until the interruption ends," along with the `interruption-start` and `interruption-end` control messages. It also carries a note worth remembering for §4:

> Note: If the `AudioContext` is `suspended` a `statechange` event is not fired for privacy reasons to avoid over-sharing user activity - e.g. when a phone call comes in or when the screen gets locked.

The published [Web Audio 1.1 First Public Working Draft (5 November 2024)](https://www.w3.org/TR/webaudio-1.1/) predates this and has only three states, so cite the ED.

### Does `play-and-record` Keep Audio Playing in the Background?

Yes—the same code path handles both types.

On iOS, WebKit installs a blanket restriction against Web Audio in the background. `Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm`, in `resetRestrictions`:

```cpp
addRestriction(PlatformMediaSession::MediaType::WebAudio, MediaSessionRestriction::BackgroundProcessPlaybackRestricted);
```

and `MediaSessionManagerInterface::applicationDidEnterBackground` turns that restriction into an interruption:

```cpp
else if (restrictions(session.mediaType()).contains(MediaSessionRestriction::BackgroundProcessPlaybackRestricted))
    session.beginInterruption(PlatformMediaSession::InterruptionType::EnteringBackground);
```

The escape hatch is in `PlatformMediaSession::beginInterruption`:

```cpp
if (protect(client())->shouldOverrideBackgroundPlaybackRestriction(type)) {
    ALWAYS_LOG(LOGIDENTIFIER, "returning early because client says to override interruption");
    m_interruptionStack.append({ type, true });
    return;
}
```

and `AudioContext` implements that client method (`Source/WebCore/Modules/webaudio/AudioContext.cpp`):

```cpp
bool AudioContext::shouldOverrideBackgroundPlaybackRestriction(PlatformMediaSession::InterruptionType interruption) const
{
    if (interruption != PlatformMediaSession::InterruptionType::EnteringBackground)
        return false;

    if (m_canOverrideBackgroundPlaybackRestriction && !destination().isConnected())
        return true;
    ...
    return hasPlayBackAudioSession(document.get());
}
```

with

```cpp
static bool hasPlayBackAudioSession(Document* document)
{
    ...
    Ref audioSession = NavigatorAudioSession::audioSession(*navigator);
    return audioSession->type() == DOMAudioSessionType::Playback || audioSession->type() == DOMAudioSessionType::PlayAndRecord;
}
```

One predicate, `Playback || PlayAndRecord`, covering both types with no branch between them. That answers the crux question: **switching FieldTone from `playback` to `play-and-record` does not silently cost background playback.**

Apple's own documentation says the same thing about the underlying category. [`AVAudioSession.Category.playAndRecord`](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord):

> Your audio continues with the Silent switch set to silent and with the screen locked. (The switch is called the Ring/Silent switch on iPhone.) To continue playing audio when your app transitions to the background (for example, when the screen locks), add the `audio` value to the UIBackgroundModes key in your information property list file.

[`playback`](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback) carries a near-identical sentence. The two categories are equivalent on this point.

### When Background Web Audio Started Working

Not in 16.4. Blame on `hasPlayBackAudioSession` and on the `return hasPlayBackAudioSession(...)` line in `shouldOverrideBackgroundPlaybackRestriction` points at commit `b848143a2ad57c80405dc5b30e61c750f5896d72`, 1 March 2024, `275558@main`, for [bug 261554](https://bugs.webkit.org/show_bug.cgi?id=261554), _[iOS] AudioContext is getting suspended when page goes in the background even if navigator.audioSession.type is set to playback_. From the commit message:

> Update AudioContext::shouldOverrideBackgroundPlaybackRestriction to be able to continue in the background in case of playback or plabyack and record DOM AudioSession(s).

The bug was filed 14 September 2023 and closed FIXED on the landing. **Which shipping release first carried it is only attested by a reporter comment in that bug** ("The latest iOS update to 17.5 has resolved the issues we were experiencing"); no Apple release note names the fix, and the Safari 17.5 post (13 May 2024) mentions only an unrelated `<audio>` background fix. Treat "iOS 17.5" as likely but unconfirmed. Treat "not in 16.4" as solid—the code did not exist.

The older behavior is from [bug 237878](https://bugs.webkit.org/show_bug.cgi?id=237878) (17 March 2022): an `AudioContext` whose destination is not connected—a silent, analysis-only context—may run in the background. That is the `m_canOverrideBackgroundPlaybackRestriction && !destination().isConnected()` clause above, and it is the one path that has been there since well before 16.4.

### The Cost of Switching: Category Override and Voice Mode

`DOMAudioSession::setType` does two things (`Source/WebCore/Modules/audiosession/DOMAudioSession.cpp`):

```cpp
if (!PermissionsPolicy::isFeatureEnabled(PermissionsPolicy::Feature::Microphone, *document, PermissionsPolicy::ShouldReportViolation::No))
    return { };

page->setAudioSessionType(type);

auto categoryOverride = fromDOMAudioSessionType(type);
AudioSession::singleton().setCategoryOverride(categoryOverride);
```

Two consequences fall out.

**First, the override is absolute.** `MediaSessionManagerCocoa::updateSessionState` consults it before anything else:

```cpp
auto category = AudioSession::CategoryType::None;
auto mode = AudioSession::Mode::Default;
if (sharedSession->categoryOverride() != AudioSession::CategoryType::None)
    category = sharedSession->categoryOverride();
else if (captureCount || (isPlayingAudio && sharedSession->category() == AudioSession::CategoryType::PlayAndRecord)) {
    category = AudioSession::CategoryType::PlayAndRecord;
    mode = AudioSession::Mode::VideoChat;
}
```

The `captureCount` branch is `else if`. With an override in place it never runs. `AudioSessionIOS::setCategory` enforces the same thing from the other end:

```cpp
if (categoryOverride() != CategoryType::None && categoryOverride() != newCategory) {
    ALWAYS_LOG(identifier, "override set, NOT changing");
    return;
}
```

`DOMAudioSession::Type::Playback` maps to `AudioSessionCategory::MediaPlayback`, which `AudioSessionIOS::setCategory` turns into `AVAudioSessionCategoryPlayback`. That category has no input. **So a page that has set `type = 'playback'` has pinned its process to a record-incapable audio session, and starting capture will not move it back.** Whether that surfaces as an ended track, a permanently muted track, or a failed `getUserMedia` is not settled by reading the code—see §6—but the category pin itself is not ambiguous.

**Second, `play-and-record` drags voice-chat mode with it.** From `AudioSession::setCategoryOverride`:

```cpp
m_categoryOverride = category;
if (category != CategoryType::None)
    setCategory(category, category == AudioSessionCategory::PlayAndRecord ? Mode::VideoChat : Mode::Default, RouteSharingPolicy::Default);
```

and `updateSessionState` reasserts it: `if (mode == AudioSession::Mode::Default && category == AudioSession::CategoryType::PlayAndRecord) mode = AudioSession::Mode::VideoChat;`. `AudioSessionIOS::setCategory` then sets `AVAudioSessionCategoryPlayAndRecord` with `AllowBluetooth | AllowBluetoothA2DP | AllowAirPlay`, adding `DefaultToSpeaker` unless the receiver is the preferred speaker, and mode `AVAudioSessionModeVideoChat` (or `VoiceChat`).

Apple on [`AVAudioSession.Mode.videoChat`](https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/videochat):

> This mode is appropriate for video chat apps that use the [playAndRecord] or [videoRecording] categories. When you set this mode, the session optimizes the device's tonal equalization for voice and reduces the set of allowed audio routes to only those suitable for video chat.

This is deliberate, and WebKit went out of its way to make it happen sooner rather than later. Commit `2416ed8f25` (3 April 2024, `276988@main`) for [bug 271305](https://bugs.webkit.org/show_bug.cgi?id=271305), _[iOS] audio level switches to VC level when starting microphone capture even if audioSession type is set to 'play-and-record' before microphone capture_:

> Make sure to always use VideoChat mode when AudioSession category is play and record.
> This ensures that, when DOMAudioSession.type is set to "play-and-record", we directly use the VC audio volume, even before starting to caputre microphone.

The bug title names the symptom plainly: setting `play-and-record` moves output onto iOS's voice-chat volume scale. WebKit's fix was to make that happen at the moment the type is set instead of at the moment capture starts, so the jump does not surprise the user mid-session. FieldTone's whole product is the timbre of an ambient bed, and this costs it both a voice-tuned EQ and a different volume curve. `updateSessionState` also drops the route-sharing policy from `LongFormAudio` to `Default` for anything that isn't `MediaPlayback`, on builds without `HAVE(AVSYSTEMROUTING_FRAMEWORK)`. Neither effect is measurable from JS; both want ears on a device.

One smaller note: `setType` silently no-ops when the Microphone permissions policy is disabled for the document, and the `type` getter then reports `'auto'`. Top-level same-origin pages are unaffected—`microphone` defaults to `self`—but a cross-origin iframe without `allow="microphone"` gets nothing, with no exception and no warning.

## 3. getUserMedia in the Background

**Answer.** The platform does not forbid it. WebKit's WebRTC owner says plainly that the muting is a consequence of the _host application's_ declared background modes, not a web-platform rule, which means the answer can differ between Safari and a Home Screen web app, and neither app's `Info.plist` is public. I could find no WebKit code that mutes or ends a microphone track merely because the application backgrounded. What I did find is several open bugs saying it fails in practice, and a `getUserMedia` call path that stalls outright while the view is hidden. **The observable signal, when it appears, is `track.muted` flipping to `true` and a `mute` event firing**—not `enabled`, which is author-only—and in the worst reported case `track.readyState` going to `ended`, or nothing at all.

### What the Signal Is, Per Spec

[Media Capture and Streams, W3C Candidate Recommendation Draft, 9 October 2025](https://www.w3.org/TR/mediacapture-streams/):

> To **set a track's muted state** to newState, the User Agent MUST run the following steps:
>
> 1. Let track be the MediaStreamTrack in question.
> 2. If track.[[Muted]] is already newState, then abort these steps.
> 3. Set track.[[Muted]] to newState.
> 4. If newState is `true` let eventName be mute, otherwise unmute.
> 5. Fire an event named eventName on track.

and on what a muted track carries:

> Media from the source only flows when a MediaStreamTrack object is both unmuted and enabled [...] zero-information-content, which means silence for audio.

So a muted track is not a stalled track: it keeps delivering buffers, and those buffers are silent. An RMS meter cannot tell the difference between a muted track and a quiet room. `track.muted` and the `mute` event can. `enabled` never changes on its own—that attribute belongs to the application.

WebKit implements this faithfully. `Source/WebCore/Modules/mediastream/MediaStreamTrack.cpp`:

```cpp
dispatchEvent(Event::create(muted ? eventNames().muteEvent : eventNames().unmuteEvent, Event::CanBubble::No, Event::IsCancelable::No));
```

and the capture unit is what pushes the state. `Source/WebCore/platform/mediastream/cocoa/BaseAudioCaptureUnit.cpp`, on suspend:

```cpp
client.setCanResumeAfterInterruption(client.isProducingData());
client.setMuted(true);
```

with the mirror on resume. That path is driven by audio session interruptions—a phone call, another app taking exclusive output—so `mute`/`unmute` is the right thing to listen for regardless of what backgrounding turns out to do.

### Does WebKit Mute Capture on Backgrounding?

Not that I can find. The iOS restriction list in `MediaSessionManagerIOS::resetRestrictions` covers `Video`, `WebAudio` and `VideoAudio`. No capture media type appears. `WebPage::applicationDidEnterBackground` (`Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm`) freezes the layer tree and forwards to the media session manager; it does not touch capture. Every call to `WebPageProxy::setMediaStreamCaptureMuted` I found is either application-driven or, on macOS, tied to hardware-console disconnection.

The throttling code points the other way—WebKit works to keep a capturing page alive. `WebPageProxy::updateThrottleState`:

```cpp
if (isCapturingMedia) {
    if (!hasValidCapturingActivity()) {
        WEBPAGEPROXY_RELEASE_LOG(ProcessSuspension, "updateThrottleState: UIProcess is taking a foreground assertion because media capture is active");
        takeCapturingActivity();
    }
}
```

A _foreground_ assertion, which is exactly the thing a backgrounded Safari cannot hand out indefinitely, so this is suggestive rather than conclusive.

The area is still moving. [Safari Technology Preview 248](https://webkit.org/blog/18162/release-notes-for-safari-technology-preview-248/), 22 July 2026: "Fixed the WebProcess `AudioSession` to remain active while microphone capture is live." Whatever the shipping behavior is on a given iOS build, it is being worked on, which argues for pinning any conclusion to a version and re-testing.

### What Starting Capture While Hidden Does

This one is unambiguous and worth designing around. `UserMediaPermissionRequestManagerProxy::processUserMediaPermissionRequest`:

```cpp
if (action == RequestAction::Grant) {
    ASSERT(!currentUserMediaRequest->requiresDisplayCapture());

    if (page->isViewVisible())
        grantRequest(*currentUserMediaRequest);
    else
        m_pregrantedRequests.append(currentUserMediaRequest.releaseNonNull());

    return;
}
```

A request that would otherwise be auto-granted from a remembered permission is parked until `viewIsBecomingVisible()` runs. **A `getUserMedia()` promise issued while the page is hidden does not reject—it hangs, until the page comes back.**

### The Bugs

Three open WebKit bugs, all still `NEW`:

- [Bug 204681](https://bugs.webkit.org/show_bug.cgi?id=204681), _Audio track goes to readyState ended when Safari is backgrounded for more than 30 seconds_, filed 28 November 2019, WebRTC component. Youenn Fablet—the WebKit engineer who owns this area and co-edits the Audio Session spec—replied on 3 December 2019:

  > We have some logic to check that the audio capture callback is being called regularly.
  > It might be that this does not happen when in the background.
  > After a few seconds, audio capture is considered as failing and the track will be ended.

  That is an engineer describing WebKit's watchdog killing a track whose samples stopped arriving, which only happens if the samples stopped arriving. The reporter came back eight days later, on iOS 13.3, with the case that should worry us most:

  > However, upon returning to the tab after 1 minute (with a red camera icon) the video element is now black, and the audio has stopped working. Both audio and video track have muted = false and readyState = live.

  **Reporter's account, iOS 13.3, December 2019—old and unconfirmed.** But it describes a track that has stopped carrying audio while every JS-visible property still says it is fine. If that failure mode survives into iOS 26, no event tells the page anything and the only detector is the audio itself.

- [Bug 241480](https://bugs.webkit.org/show_bug.cgi?id=241480), _[iOS] WKWebView WebRTC session loses microphone input when the app goes into the background_, filed 9 June 2022, `rdar://95321578`. The reporter notes input survives the inactive phase (app switcher) and dies on true background, and returns on foregrounding. **Reporter's account only; no engineer confirmation in the bug.**
- [Bug 289794](https://bugs.webkit.org/show_bug.cgi?id=289794), _[iOS] Unmuting microphone by pinching AirPods after the page is backgrounded does not work_, last changed 14 March 2025. Presupposes that a backgrounded page's mic is muted, but does not establish it.

An Apple Developer Forums thread ([689182](https://developer.apple.com/forums/thread/689182)) reports `WKWebView.microphoneCaptureState` turning `muted` shortly after `applicationDidEnterBackground`. **That is a developer's post on Apple's forum, not documentation. Unverified.**

### The Mechanism, From the Engineer Who Owns It

[Bug 226620](https://bugs.webkit.org/show_bug.cgi?id=226620), _Microphone stopped/paused when application goes to background_, filed 3 June 2021 against a WKWebView voice call. Youenn Fablet closed it `RESOLVED / CONFIGURATION CHANGED` on 23 March 2022, and the reason is the whole answer to this question:

> It is not expected that audio tracks be muted in Safari on Mac. [...]
> @dharjanto, for WKWebView, muting is happening on iOS in case UIBackgroundModes (https://developer.apple.com/documentation/bundleresources/information_property_list/uibackgroundmodes) does not contain "audio".
> Can you try that?
> Closing this bug as behaving correctly, for now.

So iOS does not forbid background microphone capture for web content. It gates it on whether the app hosting the web view declared the `audio` background mode—the same [`UIBackgroundModes`](https://developer.apple.com/documentation/bundleresources/information_property_list/uibackgroundmodes) key Apple's `playback` and `playAndRecord` docs point at. A resolution of `CONFIGURATION CHANGED` from the engineer who owns WebRTC in WebKit is about as close to "working as intended" as a bug tracker gets.

That reframes the question. It is no longer "can a web page hold the microphone in the background" but "does the app hosting this page declare background audio". Safari almost certainly does, because background playback works. What the Home Screen web app host declares is not published. A comment on the same bug from 19 October 2024 claims the split is real:

> This is broken on Web Apps that use Add to Home Screen.
> Safari: Works
> Add to Home Screen: Microphone stopped working.

**Reporter's account on a closed bug, no engineer reply. Unverified.** But it is the exact shape Fablet's rule predicts, and FieldTone ships as an installable PWA. See §5.

### Verdict

iOS does not forbid background microphone capture by policy the way it forbids, say, an `AudioContext` starting outside a user gesture. There is no such rule in WebKit's source, and the one engineer statement on the subject makes it a host-app configuration question instead. What that leaves is: a rule whose input (`UIBackgroundModes` on Safari and on the web app host) is unpublished, a six-year-old open bug, an engineer's description of a watchdog that ends silent tracks, and a design that pins a _foreground_ assertion to capture. None of that is something to build on without measuring it.

**This does not settle the design question. §6 says how to settle it.**

## 4. Page Visibility on iOS

**Answer.** The spec requires nothing here—visibility is explicitly whatever the user agent says it is, and only two values exist. WebKit's iOS implementation ties `document.hidden` to a single activity-state bit that gets cleared both when the view leaves its window (tab switch) and when the scene backgrounds (app switch, screen lock), so all three cases should read `hidden`. The catch is timing, and it comes from an Apple engineer: the process gets suspended shortly after backgrounding, and **the `visibilitychange` event may not get out before that happens.** Screen lock is not modeled as its own state. It is backgrounding plus an `isSuspendedUnderLock` flag.

### The Spec Declines to Answer

Page Visibility lives in the [WHATWG HTML Standard §6.2](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility). The trigger is handed to the implementation in as many words:

> A traversable navigable's **system visibility state**, including its initial value upon creation, is determined by the user agent. It represents, for example, whether the browser window is minimized, a browser tab is currently in the background, or a system element such as a task switcher obscures the page.

Two values, no more: `enum DocumentVisibilityState { "visible", "hidden" };`. `hidden` is defined as "return true if this's visibility state is 'hidden', otherwise false," and _update the visibility state_ returns early when the state is unchanged before it fires:

> Fire an event named `visibilitychange` at _document_, with its `bubbles` attribute initialized to true.

Screen lock appears nowhere in the HTML Standard. The only spec text that ever mentioned it is the [retired W3C Page Visibility Level 2 draft](https://www.w3.org/TR/page-visibility-2/) (Discontinued Draft, 23 June 2022, marked "MUST NOT be used for further technical work"), and there only in a non-normative note listing "The operating system's lock screen covers the user agent" as an example. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState) repeats the claim as prose, not as a requirement.

So: no spec obligation on any of the three cases. Everything below is implementation.

### What WebKit Computes

`document.hidden` on iOS reduces to one bit. `Document::visibilityState()` forwards to the page, `Page::isVisible()` is `m_activityState.contains(ActivityState::IsVisible)`, and `Page::setActivityState` calls `Document::visibilityStateChanged()` on every document when it flips. The event itself, from `Source/WebCore/dom/Document.cpp`:

```cpp
queueTaskKeepingNodeAlive(*this, TaskSource::UserInteraction, [](auto& document) {
    document.dispatchEvent(Event::create(eventNames().visibilitychangeEvent, Event::CanBubble::Yes, Event::IsCancelable::No));
```

The bit is cleared by two independent conditions, ORed together in `PageClientImpl::isActiveViewVisible` (`Source/WebKit/UIProcess/ios/PageClientImplIOS.mm`): the view leaving its window, or `[webView _isBackground]`—the app or scene backgrounding while the view stays put. Picture-in-Picture and an active WebXR session override and keep the page visible. **Web Audio does not appear in that list**, which matters: an app that keeps playing in the background is still `hidden`.

`WKApplicationStateTrackingView`, which `WKContentView` inherits from, forces the recompute on every app transition:

```objc
- (void)_applicationDidEnterBackground
{
    ...
    page->applicationDidEnterBackground();
    page->activityStateDidChange(WebCore::allActivityStates() - WebCore::ActivityState::IsInWindow);
}
```

`allActivityStates() - IsInWindow` includes `IsVisible`, so the view never has to leave its window for the page to go hidden. The background signal comes from UIKit _scene_ notifications, not application ones—`ApplicationStateTracker` observes `UISceneDidEnterBackgroundNotification` and `UISceneWillEnterForegroundNotification`. That mechanism was already in place in 2022, so it is the same at the 16.4 floor as it is today.

**Screen lock is backgrounding with a flag.** `WebPageProxy::applicationDidEnterBackground`:

```objc
bool isSuspendedUnderLock = UIApplication.sharedApplication.isSuspendedUnderLock;
...
// We normally delay process suspension when the app is backgrounded until the current page load completes. However,
// we do not want to do so when the screen is locked for power reasons.
```

That comment only makes sense if this function runs on screen lock. There is no separate lock path in the visibility plumbing.

### The Timing Problem, From Apple

[Bug 207256](https://bugs.webkit.org/show_bug.cgi?id=207256), _visibilitychange event does not get always fired on background but it may on foreground_ (filed 5 February 2020, still `NEW`). Chris Dumez, an Apple WebKit engineer, on 29 May 2020:

> Likely related to process suspension on iOS. When you lock the screen or home out of Safari, our processes get suspended shortly after. As a result, we may or may not have time to fire the visibilitychange event before we get suspended. The event normally gets fired when the process resumes if it did to have time to get fired before suspension.

That is an engineer naming both screen lock and homing out, describing a race, and confirming the event can arrive _late_—on resume—rather than at the transition. The bug is six years old and open. WebKit's source shows the ordering intent on the other side (`// This must happen after the SetActivityState message is sent, to ensure the page visibility event can fire.`), and note that backgrounding goes through the coalesced path while only the foreground transition is dispatched `Immediate` and `Synchronous`.

**Design consequence: never make `visibilitychange` the only thing that stops or starts audio.** It is best-effort on the way out.

### Per Case

- **Screen lock**—should report `hidden`, subject to the race above. No WebKit test, code comment, or engineer statement asserts the _edge_ fires on lock; the evidence is the `isSuspendedUnderLock` plumbing plus Dumez naming it. Not fully settled.
- **App switch**—same path, same race. [Bug 206213](https://bugs.webkit.org/show_bug.cgi?id=206213) claims _entering_ the OS App Switcher fires nothing until you actually switch apps. **Reporter's account, no engineer reply, `NEW` since January 2020. Unverified.**
- **Safari tab switch**—the out-of-window mechanism is proven by a WebKit API test, but whether MobileSafari removes the outgoing tab's `WKWebView` from its window is closed-source. [Bug 205942](https://bugs.webkit.org/show_bug.cgi?id=205942) claims entering the _tab switcher_ fires nothing, with an aside that actually switching tabs does fire. **Reporter's account. Unverified.**

One more finding worth flagging: page-visibility layout tests were skipped on iOS from 2016 ([bug 165799](https://bugs.webkit.org/show_bug.cgi?id=165799)) until `294731@main` added `setPageVisibility()` support in 2026, and several are still failing. This corner has had almost no automated coverage on the platform we care about.

### Adjacent, and Directly on FieldTone's Path

Three open Web Audio bugs describe exactly the resume-on-`visibilitychange` pattern failing. [Bug 281566](https://bugs.webkit.org/show_bug.cgi?id=281566), _AudioContext.resume() never resolves if browser is suspended to background_ (iOS 17.6.1, opened October 2024): the promise never settles. [Bug 202846](https://bugs.webkit.org/show_bug.cgi?id=202846), _AudioContext stops playing when suspended on visibilitychange_. [Bug 276016](https://bugs.webkit.org/show_bug.cgi?id=276016), an iOS 17.5.1 regression. **All user reports; no engineer has confirmed a mechanism in any of them.** Worth knowing before writing a `visibilitychange` handler that awaits `resume()`.

## 5. Home-Screen PWA Versus Safari Tab

**Answer.** Inside open-source WebKit, standalone display mode is a CSS media feature and a legacy `navigator.standalone` boolean. Nothing in the audio, capture, or process-throttling code branches on it. Every real difference therefore comes from the _host application_—Safari versus the separate web app process—whose entitlements, background modes and permission store Apple does not publish. WebKit engineers have said exactly that, in two different components four years apart. So: **no primary source documents a standalone-versus-tab difference for background audio or background capture today, and the code cannot produce one, but the history says the host has diverged before, repeatedly, and one engineer statement plus one user report suggest it may be diverging on the microphone right now.**

### The Negative Finding, Stated Plainly

The `display` member of the manifest reaches exactly one runtime consumer: `displayModeFeatureSchema()` in `Source/WebCore/css/query/MediaQueryFeatures.cpp`, which maps it onto the CSS `display-mode` media feature. The separate `Standalone` WebKit preference (`WKPreferences._standalone`) is read by exactly one function, `Navigator::standalone()`, guarded by `ENABLE(NAVIGATOR_STANDALONE)`; searching that macro across the tree returns six files, all IDL, headers or build config. A code search for `applicationManifest` returns 99 files—manifest parsing, loading, plumbing, Web Inspector, CSP tests, layout tests—and **zero** under `Source/WebCore/platform/audio`, `Source/WebCore/platform/mediastream`, `Source/WebCore/Modules/mediastream`, `Source/WebCore/Modules/webaudio`, or any process-throttling file. Grepping the specific files quoted in §2 and §3 for `displayMode` finds nothing.

That is worth stating positively: **the mechanisms in §2 and §3 are keyed on media type, audio session type and application background state. None of them can tell a PWA from a tab.**

### Where the Difference Does Live

Two WebKit engineers, on two different bugs, said the fix was outside WebKit.

[Bug 198277](https://bugs.webkit.org/show_bug.cgi?id=198277), _Audio stops playing when standalone web app is no longer in foreground_, filed 27 May 2019. Jer Noble, 15 January 2020:

> But because the issues causing this behavior may be due to the underlying platform, investigation is being tracked inside Radar, rather than here on bugzilla.

Youenn Fablet, 25 January 2021: "This bug is tracked internally, the required fix might not be at WebKit level." It was eventually duped to [bug 232909](https://bugs.webkit.org/show_bug.cgi?id=232909), _[iOS] Adopt -[AVAudioSession setAuditTokensForProcessAssertion:]_—an audio-session process-assertion change, not a display-mode branch—and Sam Sneddon noted it "was a change shipped in iOS 15.4." Below our floor, so `<audio>` should be at parity today. But the bug ran three years, and for those three years a standalone web app and a Safari tab did behave differently on exactly the axis this spike is about.

The same bug also carries Jer Noble's description of the pre-`audioSession` world, on 8 February 2022, which corroborates §2's reading of the category code:

> This is expected. On iOS, WebAudio is considered "Ambient" audio from the system's perspective, and ambient audio is blocked by the system once the app producing it is no longer foreground.

He adds that it applied "Regardless of whether the site is installed or not"—Web Audio was broken in the background _everywhere_ until `navigator.audioSession` gave pages a way to say otherwise.

[Bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884), _getUserMedia recurring permissions prompts in standalone when hash changes_, is the other one. Youenn Fablet, 16 September 2020:

> It seems as if there is a navigation which stops all the capture tracks and reset the permissions when doing hash navigations in Web.app but not iOS Safari.

Note the app name. On 5 January 2021: "The fix is not in WebKit but in Safari standalone mode implementation." The bug is closed `CONFIGURATION CHANGED`.

The pattern held as recently as last year: [Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) (31 March 2025) announced "The Screen Wake Lock API now also works in Home Screen Web Apps on iOS and iPadOS 18.4"—an API Safari itself had since 16.4, missing from web apps for two years, with nothing in the open tree to explain the gap. The cause was named in [bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545) by Chris Dumez on 25 April 2023, and it is the architectural fact underneath all of this:

> We rely on the following code to keep the screen awake on iOS:
> `[UIApplication sharedApplication].idleTimerDisabled = YES;`
> This likely does't work in Home Screen Web Apps because they are not UIApplications but ViewServices.

_Not UIApplications but ViewServices._ That is why the difference exists and why it is invisible to a grep. `ApplicationStateTracker` already reflects it: a view service takes a completely separate branch, deriving foreground/background from the **host process's** RunningBoard visibility endowment and `_UIViewServiceHostSceneDidEnterBackgroundNotification`, never from `UISceneDidEnterBackgroundNotification` on its own scene. Different inputs, same output bit. That branch has been the site of two confirmed standalone-only visibility bugs already: [180523](https://bugs.webkit.org/show_bug.cgi?id=180523) (screen lock did not go `hidden` in a standalone app on iOS 11 while it did in a tab) and [202399](https://bugs.webkit.org/show_bug.cgi?id=202399), duped to [201737](https://bugs.webkit.org/show_bug.cgi?id=201737), whose fix was precisely to change which view-service notifications the standalone path observes.

### The Microphone, Specifically

§3 established the rule: Youenn Fablet says iOS mutes capture when the host app's `UIBackgroundModes` lacks `audio`. **The host is different for a PWA, and that is the entire risk.** The only evidence either way is a comment on that same bug ([226620](https://bugs.webkit.org/show_bug.cgi?id=226620), 19 October 2024): "Safari: Works / Add to Home Screen: Microphone stopped working." **Unverified user report on a closed bug.** Neither `Info.plist` is public. This has to be measured.

### Permissions

WebKit does not implement durable `getUserMedia` permission at all. `UserMediaPermissionRequestManagerProxy` keeps grants in in-memory per-page vectors (`m_grantedRequests`, `m_pregrantedRequests`), clears them on navigation away from the granting origin, and re-prompts after an inactivity interval; anything persistent comes back from the embedder through `hasCameraPersistentAccess` / `hasMicrophonePersistentAccess`. So persistence is Safari's, or the web app host's, and again not WebKit's to differ on.

The most recent word is Fablet on bug 215884, **3 February 2026**, replying to a report that a Safari "Allow" does not carry into the installed app:

> It seems your ask is about having persistent permission in PWA when persistent permission is set in Safari. Would you be willing to file a new bug for this? Otherwise, I can do it on your behalf.

Read that as: as of this year, a Home Screen web app does not inherit or hold a persistent mic grant the way Safari does, and it is not tracked as fixed. **Plan for a prompt on each cold start of the installed app.** Note also, from §3, that a pre-granted request is parked until the view is visible, so a permission prompt and a hidden page interact badly.

### Storage, for Completeness

Documented and settled, though not what this spike is about. Home Screen web apps have had separate cookies and storage from the browser since well before 16.4—Brent Fulgham on [bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849), 1 February 2022: "The current behavior (on Apple platforms) is by design. Home Screen apps are created as isolated entities without shared state with the browser." [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) (10 August 2023) confirms a standalone web app gets the browser quota tier, not the embedded-WebView tier: "When a web app is running standalone [...] it has the same origin quota and overall quota as when it is opened in a browser app." And [ITP's seven-day script-writable storage cap](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) runs its own counter for a web app, because it "is not part of Safari."

One change worth noting for the floor: as of [Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), "By default, every website added to the Home Screen opens as a web app [...] There are now zero requirements for 'installability' in Safari." Standalone is no longer opt-in, so the PWA path is the default path for anyone who adds FieldTone to their home screen.

## 6. What Remains Empirical

Everything here needs a physical iPhone. None of it is a gap more reading would close: each one is a behavior no primary source states, usually because the deciding input is inside a closed component: UIKit, Safari, or the Home Screen web app host.

Run every test in **both** a Safari tab and an installed web app. §5 shows WebKit cannot tell them apart, and §5 also shows the host has diverged before.

1. **Does a microphone track keep delivering non-silent audio while the app is backgrounded or the screen is locked?** The most important unknown. Fablet's rule (§3) says it comes down to whether the host app declared the `audio` background mode, and neither `Info.plist` is public. Test: hold a track, log `muted`, `enabled` and `readyState` on every `mute`, `unmute` and `ended`, and _separately_ record RMS into a ring buffer so a silent-but-unmuted track is distinguishable from a muted one. Background the app, lock the screen, and wait past 30 seconds, which is bug 204681's watchdog threshold. Do not trust the events alone: that bug reports a track reading `muted = false, readyState = live` while carrying nothing.

2. **Does the answer to 1 differ between a Safari tab and the installed web app?** The one report on the subject says yes—"Safari: Works / Add to Home Screen: Microphone stopped working"—and it is unverified. If it holds, it constrains the product, not just the code: FieldTone is required to be installable, and installation would be the thing that breaks listening in the background.

3. **What actually happens when a page holding a microphone track has `audioSession.type = 'playback'`?** The category pin is certain (§2). The user-visible consequence is not. Candidates: `getUserMedia` rejects, the track arrives already muted, the track arrives live and silent, or the track ends. The spec says a conforming UA ends it; WebKit has no code that does. Test the four-way directly, because this is the failure the app would ship with today if it added the mic without touching the session type.

4. **How audible is `videoChat` mode, and how much quieter is the voice-chat volume scale?** Apple says the session "optimizes the device's tonal equalization for voice and reduces the set of allowed audio routes," and WebKit bug 271305 confirms output moves to the VC volume level the instant the type is set. No source quantifies either. Record the same Bed through `playback` and through `play-and-record`, on speaker and over Bluetooth, and listen; note where the hardware volume slider lands. This one needs ears rather than a meter.

5. **Which shipping iOS version first kept Web Audio playing in the background under `type = 'playback'`?** Landed 1 March 2024 in `275558@main`; attested as iOS 17.5 only by a bug reporter. On 16.4 through roughly 17.4 the background restriction applies unconditionally, so at the current floor the app must behave sanely on versions where background playback simply does not happen. Pinning the boundary needs old devices or a version matrix. Alternatively, raise the floor and skip the question.

6. **Does `visibilitychange` actually fire on screen lock, on app switch, and on tab switch—and how late?** WebKit's model says all three should report `hidden` (§4), but an Apple engineer says the event races process suspension and may only arrive on resume, and the three bugs claiming it does not fire are all unverified reporter accounts. iOS had no page-visibility layout-test coverage from 2016 to 2026. Test each transition with a timestamped log that survives suspension—write to `localStorage` or IndexedDB in the handler, not to the console.

7. **Whether an interruption—an incoming call—produces a usable signal.** `navigator.audioSession.state` does not exist in Safari (§2), so the only candidate is `audioContext.state === 'interrupted'` plus its `statechange`. The Web Audio ED explicitly suppresses that event when the context was already `suspended`, and which state a backgrounded FieldTone context is in when a call arrives is not something the source settles. Test with a real phone call, backgrounded and foregrounded.

8. **Does `audioContext.resume()` resolve after a background round trip?** Three open bugs say it can hang forever ([281566](https://bugs.webkit.org/show_bug.cgi?id=281566), [276016](https://bugs.webkit.org/show_bug.cgi?id=276016), [202846](https://bugs.webkit.org/show_bug.cgi?id=202846)), all reporter accounts with no engineer confirmation. If FieldTone ever awaits `resume()` on a `visibilitychange`, this is the bug that eats the app. Test the round trip, and time out the await.

9. **Does a microphone grant survive a cold start of the installed web app?** Fablet's February 2026 comment predicts no (§5). Confirm on the target versions, since it plausibly differs across 16.4, 18.x and 26.
