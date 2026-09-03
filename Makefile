.PHONY: test report check

test:
	@lua5.4 test/run.lua

report:
	@lua5.4 test/report.lua

# Syntax-check everything that ships to a server.
check:
	@for f in collector/config.lua collector/server/*.lua collector/fxmanifest.lua; do \
		lua5.4 -e "assert(loadfile('$$f'))" && echo "ok   $$f" || exit 1; \
	done
