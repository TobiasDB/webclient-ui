# webclient-ui -- the web front ends of the webclient package (they talk to its HTTP API only).
#
#   make install      npm install (every workspace)
#   make up           the whole stack for development: the API, the site (the lab) and the Playground
#                     together -- Ctrl-C stops all three
#   make playground   the Playground dev server                     http://localhost:5173
#   make storybook    the component library in Storybook            http://localhost:6006
#   make site         the website / lab in dev mode                 http://localhost:4321
#   make site-serve   the website built and served (SSR: every lab fixture, headers and status included)
#   make api          the webclient HTTP API (from ../webclient)    http://localhost:8000
#   make check        the gate: typecheck every workspace + unit tests + the Storybook build
#   make typecheck / make test / make build / make build-storybook
#   make e2e          the Run workspace end to end, against recorded runs (starts its own API + dev server)
#   make lab-test     the package's lab suite against the served site (needs `make site-serve`)
#   make clean        remove build output
#
# Node 22 comes from Homebrew (override NODE_BIN); the API from the sibling package (WEBCLIENT).

NODE_BIN   ?= /opt/homebrew/opt/node@22/bin
export PATH := $(NODE_BIN):$(PATH)

WEBCLIENT  ?= ../webclient
PY         ?= $(WEBCLIENT)/env/bin/python
API_PORT   ?= 8000
SITE_PORT  ?= 4321
API_URL    ?= http://localhost:$(API_PORT)
TRACES_DIR ?= $(abspath $(WEBCLIENT))/traces

export API_URL

.PHONY: help install up playground storybook site site-build site-serve api check typecheck test build build-storybook e2e lab-test clean

help:
	@sed -n '1,/^$$/p' $(firstword $(MAKEFILE_LIST)) | sed 's/^# \{0,1\}//'

install:
	npm install

# -- run --------------------------------------------------------------------------------------------
playground:
	npm run dev:playground

storybook:
	npm run storybook

site:
	npm run dev:site

site-build:
	npm run build:site

site-serve: site-build
	HOST=127.0.0.1 PORT=$(SITE_PORT) node apps/site/dist/server/entry.mjs

api:
	cd $(WEBCLIENT) && WEBCLIENT_SERVICE_PORT=$(API_PORT) WEBCLIENT_TRACES_DIR=$(TRACES_DIR) $(abspath $(PY)) -m webclient.service

# the three together: each in the background, their output interleaved; Ctrl-C (or any one exiting)
# stops them all
up: site-build
	@trap 'kill 0' INT TERM EXIT; \
	echo "api        $(API_URL)"; \
	(cd $(WEBCLIENT) && WEBCLIENT_SERVICE_PORT=$(API_PORT) WEBCLIENT_TRACES_DIR=$(TRACES_DIR) $(abspath $(PY)) -m webclient.service 2>&1 | sed 's/^/[api] /') & \
	(HOST=127.0.0.1 PORT=$(SITE_PORT) node apps/site/dist/server/entry.mjs 2>&1 | sed 's/^/[site] /') & \
	echo "site       http://127.0.0.1:$(SITE_PORT)"; \
	(npm run dev:playground 2>&1 | sed 's/^/[playground] /') & \
	echo "playground http://localhost:5173"; \
	wait

# -- the gate ---------------------------------------------------------------------------------------
check: typecheck test build-storybook

typecheck:
	npm run typecheck

test:
	npm run test

build:
	npm run build

build-storybook:
	npm run build:storybook

# the Run workspace end to end: recorded runs (apps/playground/e2e/traces) replayed in a real browser
e2e:
	cd apps/playground && WEBCLIENT=$(abspath $(WEBCLIENT)) npx playwright test

# the package's lab suite, run against the served site (start `make site-serve` first)
lab-test:
	cd $(WEBCLIENT) && LAB_URL=http://127.0.0.1:$(SITE_PORT) $(abspath $(PY)) -m pytest -q tests/test_lab.py

clean:
	rm -rf apps/playground/dist apps/site/dist packages/ui/storybook-static
