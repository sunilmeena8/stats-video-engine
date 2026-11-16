# Music and editorial storytelling

How Statsopedia videos get their soundtrack, their editorial notes, and their opening and
closing scenes. The same code runs in the Video Studio preview, in the API before a render is
queued, and in the render worker, for both long-form (16:9) and Shorts (9:16).

## Video structure

```
[intro][bar chart race + annotations][outro: final ranking → end card][source credits]
```

| Scene          | Shows                                                                                                                                    | Configured by                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Intro          | Statsopedia branding, title, subtitle, metric description, metric · unit · period range                                                  | `intro`, `metricDescription`                     |
| Bar chart race | Year counter, ranking animation, values, compact source label, annotations                                                               | range, top N, speed, `sourceText`, `annotations` |
| Outro          | The final ranking: the winner (joint winners on a tie) and the rest of the top five; then, when the outro is 3 s or longer, the end card | `outro` (`text` is the end-card line)            |
| Credits        | Data sources, sources cited by annotations, the music credit, and how values were prepared                                               | `credits.enabled`, `durationSeconds`, `showUrls` |

The music credit (when the license requires one) is also shown at the bottom of the outro.
`raceScenes(timeline)` in `@statsopedia/video-config` lists the scenes. The Studio uses it for
its scene timeline and the estimated duration.

## Music library

Music is uploaded to the Media Library with its licensing (`POST /api/media`, see
[api.md](api.md#media)).

- **Validated on upload.** The file is identified by its bytes (WAV, MP3, OGG, M4A), then fully
  decoded with FFmpeg: corrupt files are refused (`INVALID_AUDIO`), and so are silent tracks
  (`SILENT_AUDIO`) and tracks outside 5 s to 30 min (`INVALID_AUDIO_LENGTH`).
- **Measured on upload.** Duration, codec, sample rate, channels, integrated loudness (LUFS)
  and true peak (dBTP) are stored as `audio`.
- **Licensing.**
  - Every track needs a category (corporate, cinematic, technology, energetic, ambient,
    documentary), a license type, and an answer to "may it be used commercially?".
  - It can also record the license name, the credit line, and where the license is documented.
  - A license that requires attribution must state the credit line.
- **Edits.** `PATCH /api/media/:id` corrects the name, category or licensing; the file itself
  never changes.
- **Older tracks.** Tracks uploaded before analysis existed can be measured with
  `pnpm --filter @statsopedia/api media:analyze`.

Each render records a copy of the music's licensing as it was at submission
(`manifest.musicLicense`), so later edits never change what a finished video recorded.

### How music plays

| Setting                 | Behaviour                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume                  | 0–100%, never above the track as mastered. A track whose true peak would exceed −1 dBTP at that volume is turned down (`safeMusicGain`), and the Studio shows the volume it will actually play at.            |
| Fade in / out           | Applied over the whole video; the last frame is always silent.                                                                                                                                                |
| Track longer than video | Cut after the fade-out.                                                                                                                                                                                       |
| Track shorter           | With `loop` on, the track repeats with 1.5 s linear crossfades. Overlapping plays always sum to unity gain, so the seams cannot clip. With `loop` off, the render is refused: loop it or pick a longer track. |

`planMusic` (video-config) lays the plays out; `BackgroundMusic` renders them as Remotion
`<Audio>` sequences.

## Editorial annotations

| Field      | Notes                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`     | `milestone` (historical event), `ranking_change`, `winner`, `top_entry`, `value_change`, `caption`                                                                                                                           |
| `title`    | Up to 80 characters; the card shows up to 2 lines                                                                                                                                                                            |
| `text`     | Up to 240 characters; the card shows up to 3 lines                                                                                                                                                                           |
| `icon`     | Optional emoji or symbol                                                                                                                                                                                                     |
| `imageUrl` | Optional: an uploaded image or logo (`media:<asset id>`), an http(s) URL, or a renderer public file                                                                                                                          |
| `sources`  | `{ name, url }[]`. At least one source is **required for every kind except `caption`**; the shared schema refuses a fact without one. The source name is shown on the card, and all sources are listed in the credits scene. |
| `timing`   | `{ kind: 'period', period, durationSeconds }` (from the moment the period is reached), or `{ kind: 'time', startSeconds, endSeconds }`                                                                                       |
| `priority` | `high`, `normal` or `low`                                                                                                                                                                                                    |
| `style`    | `card`, `callout` or `banner`                                                                                                                                                                                                |
| `position` | `auto` (recommended) or a corner                                                                                                                                                                                             |

**Placement** (`planAnnotations`, pure and shared by the Player, renders and the checks):

- Notes are shown only during the race, never over the intro, outro or credits.
- Higher priority goes first. A note whose place is taken waits until it frees up, keeping its
  length; if no place frees up before the race ends, it is skipped and the checks fail.
- `auto` picks the corner that covers the fewest ranked rows while the note is on screen, so
  notes sit beside the short bars, not on the leaders.
- In Shorts, notes use the title band above the chart and never cover the bars.

**Suggestions.** "Suggest from data" (`suggestAnnotations`) reads lead changes, first entries
into the top N, the largest moves (25% or more) and the winner from the dataset version itself.
Each suggestion cites the dataset's sources. Historical events are never suggested or invented:
milestones are written by an editor, with their sources.

## Quality checks

`checkRaceQuality` (chart-components, also available without React as
`@statsopedia/chart-components/pure`) runs live in the Studio for every output format. The API
runs it again before queueing: any `fail` refuses the render with `422 QUALITY_CHECK_FAILED`.
The report is stored with the manifest.

| Check                                 | Fails when                                                                        | Warns when                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Music covers the video                | Track shorter than the video and not looped                                       | Track length not measured                                          |
| Music is audible                      | Volume 0, silent track, or below −45 LUFS in the video                            | Below −32 LUFS, or not analysed                                    |
| Music is not clipped                  | —                                                                                 | Track not analysed (otherwise the gain is lowered to −1 dBTP)      |
| Music fades in and out                | Fades longer than the video                                                       | Fade-out under 0.5 s, or no fade-in                                |
| Music license allows this use         | No commercial use (final renders), or attribution required but no credit line     | Commercial use not recorded; non-commercial in previews            |
| Text is readable                      | —                                                                                 | Text under 12 px, low contrast, title over 2 lines, truncated note |
| Annotation facts cite sources         | (refused by the schema)                                                           | A caption states figures without a source                          |
| Annotations keep the chart visible    | —                                                                                 | A note covers ranked bars (the ranks are named)                    |
| Annotations do not overlap each other | A note cannot be placed before the race ends                                      | A note is delayed by a higher-priority one                         |
| Source credits are visible            | No source at all, or a required music credit with neither outro nor credits scene | No credits scene, or one too short to read                         |
| Scenes fit the video                  | A Short longer than 3 minutes                                                     | A note outside the race, or shortened to fit                       |

After rendering, the worker measures the encoded audio itself and refuses to publish a video
whose music is silent, clips above 0 dBTP, or does not fade out (or does not fade in, when a
fade-in was set). It checks the first and last 50 ms. The results are stored in
`output.metadata.qualityChecks`, and the Render Queue's job details show both reports.

## Preview

The Studio plays the production composition in the Remotion Player with the real props,
including the music (through the dashboard proxy) and annotation images:

- **Layouts.** Switch between long-form and Shorts.
- **Navigation.** Scrub frame by frame. The scene timeline shows the intro, race, final ranking
  and credits with a marker for each annotation (amber when it covers bars or was delayed);
  click it, or use the scene buttons, to jump.
- **Estimated duration.** Shown next to the scene buttons.
- **Checks.** The quality checks are shown below the Player, and the render buttons are
  disabled while a check fails.
