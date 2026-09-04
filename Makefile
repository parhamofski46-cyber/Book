FIXTURES := backend/test/fixtures/threeday.jsonl

.PHONY: test test-collector test-backend fixtures report check run clean release verify package

test: test-collector test-backend

test-collector:
	@echo "== collector (Lua) =="
	@lua5.4 test/run.lua

test-backend: $(FIXTURES)
	@echo "\n== backend (Node) =="
	@cd backend && node --no-warnings test/run.js

# Fixtures are the collector's real output, replayed by the backend suite.
# Generated rather than committed: the simulator is deterministic, so the file
# is reproducible from the code that made it.
fixtures: $(FIXTURES)

$(FIXTURES): sim/*.lua collector/config.lua collector/server/*.lua
	@echo "== generating fixtures from the simulator =="
	@lua5.4 sim/dump.lua 72 $@

report:
	@lua5.4 test/report.lua

# The one check that puts Lua, HTTP and Node in the same sentence: starts a
# clean backend, registers a server, and has the real collector report into it
# over the network. Slower than the suite, so it is its own target.
verify:
	@sh scripts/verify-live.sh

# Syntax-check everything that ships to someone else's server.
check:
	@for f in collector/config.lua collector/server/*.lua collector/fxmanifest.lua; do \
		lua5.4 -e "assert(loadfile('$$f'))" && echo "ok   $$f" || exit 1; \
	done
	@cd backend && for f in $$(find src -name '*.js'); do \
		node --check $$f && echo "ok   backend/$$f" || exit 1; \
	done

run:
	@cd backend && node --no-warnings src/main.js

# Release assets: dashboard screenshots and the landing page built from them.
# Needs playwright-core available to release/screenshot.js.
release: $(FIXTURES)
	@node --no-warnings release/screenshot.js
	@node --no-warnings release/build-landing.js

# The zip attached to the GitHub release. Server owners who only want the
# resource should not have to clone anything -- and a release asset is the one
# install signal GitHub actually counts.
VERSION := $(shell sed -n "s/^version '\(.*\)'/\1/p" collector/fxmanifest.lua)

package:
	@rm -rf dist && mkdir -p dist/pulse_collector
	@cp -r collector/* dist/pulse_collector/
	@cd dist && zip -qr pulse_collector-v$(VERSION).zip pulse_collector
	@rm -rf dist/pulse_collector
	@ls -la dist/

clean:
	@rm -rf backend/test/fixtures backend/data release/landing.html dist
