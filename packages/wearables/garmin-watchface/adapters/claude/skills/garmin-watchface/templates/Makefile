.PHONY: build sim test lint package deploy clean key doctor devices

NAME    := my-face
DEVICE  ?= fenix6pro
JUNGLE  := monkey.jungle
TEST_JUNGLE := monkey.jungle;monkey.test.jungle
KEY     ?= $(HOME)/.Garmin/ConnectIQ/developer_key.der
APP     := bin/$(NAME).prg
IQ      := bin/$(NAME).iq
WATCH   := /Volumes/GARMIN/GARMIN/APPS

# Homebrew's openjdk is keg-only and the SDK ships no JDK, so neither is on PATH
# by default. The SDK also lives under "Application Support" -- a path with a
# space, which make's direct-exec lookup mishandles -- so tools are invoked by
# absolute quoted path rather than via PATH.
CIQ     := $(HOME)/Library/Application Support/Garmin/ConnectIQ
SDK     := $(shell cat "$(CIQ)/current-sdk.cfg" 2>/dev/null | tr -d '\n')
JDK     := $(shell brew --prefix openjdk 2>/dev/null)/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME := $(JDK)
export PATH := $(JDK)/bin:$(PATH)

MONKEYC  := "$(SDK)bin/monkeyc"
MONKEYDO := "$(SDK)bin/monkeydo"

build:
	@mkdir -p bin
	$(MONKEYC) -f $(JUNGLE) -d $(DEVICE) -o $(APP) -y $(KEY) -w -l 2

# Cannot use -o /dev/null: the compiler caches bitmap resources next to the
# output path and fails when that path is not a real file.
lint:
	@mkdir -p bin
	$(MONKEYC) -f $(JUNGLE) -d $(DEVICE) -o bin/.lint.prg -y $(KEY) -w -l 3

sim:
	@"$(SDK)bin/connectiq" &
	@sleep 4
	$(MONKEYDO) $(APP) $(DEVICE)

# Note the second jungle. Without it every (:test) function is stripped and the
# run reports success having compiled nothing.
test:
	@mkdir -p bin
	$(MONKEYC) -f "$(TEST_JUNGLE)" -d $(DEVICE) -o $(APP) -y $(KEY) -w -l 2 --unit-test
	$(MONKEYDO) $(APP) $(DEVICE) -t

package:
	@mkdir -p bin
	$(MONKEYC) -f $(JUNGLE) -e -r -o $(IQ) -y $(KEY) -w -l 3
	@echo "Store package: $(IQ)"

deploy: build
	@test -d $(WATCH) || { echo "ERROR: watch not mounted at $(WATCH)"; exit 1; }
	cp $(APP) $(WATCH)/
	@echo "Copied. Eject, then pick the face on-device."

key:
	@test ! -f $(KEY) || { echo "Key already exists at $(KEY)"; exit 1; }
	@mkdir -p $(dir $(KEY))
	openssl genrsa -out $(KEY:.der=.pem) 4096
	openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt \
		-in $(KEY:.der=.pem) -out $(KEY)
	@echo "Developer key written to $(KEY) -- back it up, never commit it."

doctor:
	@~/.claude/skills/garmin-watchface/scripts/ciq-doctor $(DEVICE)

devices:
	@~/.claude/skills/garmin-watchface/scripts/ciq-devices --same-as $(DEVICE)

clean:
	rm -rf bin/
