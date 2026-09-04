# Publishing checklist

Everything in `release/` is ready to post. What follows is the order to do it
in, and the four decisions that have to be made first because they are not
code.

## Before anything is public

**1. Move it to its own repository.** This currently lives in a repo called
`Book`, which tells a visitor nothing. Create `pulse-fivem` (or similar) and
push there. The repository name is the first thing anyone reads.

**2. Replace the backend licence.** `backend/LICENSE` is a plain statement of
intent that has not been reviewed by a lawyer. Before publishing, paste in the
official text of whichever standard form you choose — Business Source License
1.1 or Elastic License 2.0 are the usual choices for exactly this shape of
project. Copy them verbatim; do not paraphrase. The collector stays MIT.

**3. Decide where the hosted backend will live**, even if the answer is "not
yet". People will ask on the thread. "Self-host today, hosted later" is a fine
answer; silence is not.

**4. Sort out how you get paid**, before there is anything to be paid for. It
does not block this release — the free version needs no payment rail — but it
blocks every version after it.

Then replace `YOUR-GITHUB` everywhere:

```sh
grep -rl 'YOUR-GITHUB' README.md release/ | xargs sed -i 's|YOUR-GITHUB|<owner>/<repo>|g'
```

## Publishing

**5. Tag it.**

```sh
git tag -a v0.1.0 -m "Pulse v0.1.0"
git push origin v0.1.0
```

Create a GitHub release from the tag with `CHANGELOG.md` as the body, and
attach a zip of `collector/` so people who only want the resource do not have
to clone the repository.

**6. Post to the Cfx forum.** `forum.cfx.re` → Releases → Server Resources.
The body is `release/forum-post.md`; the forum takes Markdown. Drag the
screenshots in where the `<!-- SCREENSHOT -->` markers are — the forum rewrites
them to its own CDN, so do not hotlink from GitHub.

Title it plainly. `[Free] Pulse — find out which resource made your server
slow` says what it is. Avoid "revolutionary", "the best", and anything in
capitals; that audience reads it as a reason to skip the thread.

**7. Then, and only then, the other channels.** `r/FiveM` on Reddit, and the
larger FiveM development Discords. Post the same substance in fewer words and
link the forum thread — do not paste the whole thing four times.

## The first two weeks

This is the part that decides whether it works, and it is not code.

- **Answer everything, quickly.** A thread with unanswered questions reads as
  abandoned. Reply even to "does it work with ESX?" (it does; it does not care
  which framework you run).
- **When someone says it blamed the wrong resource, that is the most valuable
  message you will get.** Ask for the timestamp and what actually changed. That
  is real-world data the simulator cannot give you, and the analysis will only
  get sharper from it.
- **Ship a fix within a day or two of the first real bug.** Nothing builds
  trust in this community faster than a fast, honest patch.
- **Do not mention the paid tier yet.** Nothing is being withheld today, and
  saying "pro version coming soon" in a free release invites a fight about it.
  When the hosted version exists, it is its own announcement.

## What to say when it comes up

**"How is this different from Overwolf / resmon?"** Those show you now. This
records, so it can tell you what changed and when.

**"Will it slow my server down?"** It measures its own cost, ships that number,
and throttles itself if it goes over budget. The dashboard shows it. Measured
at 0.0084% of one core.

**"Is it safe to install?"** The collector is MIT, dependency-free Lua, seven
files. Read it. The backend is yours to self-host; nothing leaves your machine
unless you point it somewhere.

**"Have you tested this on a real server?"** No — and say so. It is validated
against a simulator, and that is exactly why you are asking people to try it.
Claiming otherwise gets found out in a day and costs the whole launch.
