# Publishing checklist

Everything in `release/` is ready to post. What follows is the order to do it
in, and the four decisions that have to be made first because they are not
code.

## Before anything is public

**1. Move it to its own repository.** This currently lives in a repo called
`Book`, which tells a visitor nothing. Create `pulse-fivem` (or similar) and
push there. The repository name is the first thing anyone reads.

**2. Put your name on the copyright.** The licences are in place: MIT at the
repository root and in `collector/`, the official Elastic License 2.0 text
verbatim in `backend/LICENSE`. What is still a placeholder is who owns it:

```sh
grep -rl 'the Pulse authors' LICENSE NOTICE collector/ backend/NOTICE \
  | xargs sed -i 's|the Pulse authors|<your legal name or company>|g'
```

A copyright line naming nobody in particular is weak. None of this has been
reviewed by a lawyer — the texts are the standard published ones, but if real
money ends up depending on the hosted-service restriction, have someone look at
it.

**3. Decide where the hosted backend will live**, even if the answer is "not
yet". People will ask on the thread. "Self-host today, hosted later" is a fine
answer; silence is not.

**4. Sort out how you get paid**, before there is anything to be paid for. It
does not block this release — the free version needs no payment rail — but it
blocks every version after it.

Then replace the placeholders everywhere — the landing page carries them too,
so one pass catches all of it:

```sh
grep -rl 'YOUR-GITHUB' README.md release/ | xargs sed -i 's|YOUR-GITHUB|<owner>/<repo>|g'
# once the forum thread exists:
grep -rl 'YOUR-THREAD' release/ | xargs sed -i 's|forum.cfx.re/YOUR-THREAD|<thread url>|g'
node release/build-landing.js   # rebuild the page with the real links
```

Before any of it, run the checks:

```sh
make test     # 117 tests
make verify   # the real collector against a real backend, over real HTTP
```

## Publishing

**5. Tag it.**

```sh
git tag -a v0.1.0 -m "Pulse v0.1.0"
git push origin v0.1.0
```

```sh
make package   # dist/pulse_collector-v0.1.0.zip
```

Create a GitHub release from the tag with `CHANGELOG.md` as the body and that
zip attached. Two reasons: someone who only wants the resource should not have
to clone anything, and **a release asset is the one install signal GitHub
counts** — the download total is on the release page and in the API at
`/repos/<owner>/<repo>/releases`. Nothing else tells you how many servers are
running this, because the backend is theirs, not yours.

**5b. Try the install yourself, on a clean machine.** Clone the published
repository into a fresh directory and run `sh install.sh` exactly as a stranger
would. Everything in the post depends on that working the first time, and you
only get one first impression per person.

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
