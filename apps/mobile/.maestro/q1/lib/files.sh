#!/bin/bash
# Makes the nonpersonal test files the picker flows choose (P2, D4, behaviour/s7-file) and copies them into the
# simulator's Files › On My iPhone, or into an Android emulator's Downloads.
# Usage: .maestro/q1/lib/files.sh <simulator udid | emulator serial, e.g. emulator-5554>
set -euo pipefail
udid=${1:?simulator udid or emulator serial}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
cat > resume.txt <<'TXT'
Jordan Sample
Product designer
jordan@example.org · +1 555 0100 · Springfield

Experience
Senior product designer, Example Labs — 2021 to Present
Led the design system used by four product teams.

Product designer, Sample Studio — 2017 to 2021
Designed onboarding and billing flows.

Education
BA Design, Example University — 2013 to 2017

Skills
Figma, prototyping, user research, design systems
TXT
cupsfilter resume.txt > q1-resume.pdf 2>/dev/null
# A scan: one page that is only a picture (the storyboard's own page fixture).
cat > make.swift <<'SWIFT'
import AppKit
import PDFKit
let dir = CommandLine.arguments[1]
let text = PDFDocument(url: URL(fileURLWithPath: dir + "/q1-resume.pdf"))!
text.write(to: URL(fileURLWithPath: dir + "/q1-locked.pdf"), withOptions: [.userPasswordOption: "secret", .ownerPasswordOption: "secret"])
let scan = PDFDocument()
scan.insert(PDFPage(image: NSImage(contentsOfFile: CommandLine.arguments[2])!)!, at: 0)
scan.write(to: URL(fileURLWithPath: dir + "/q1-scan.pdf"))
SWIFT
swift make.swift "$work" "$here/../../../assets/fixtures/page-public-full.png"
# Over the 25 MB limit.
cp q1-resume.pdf q1-huge.pdf && head -c 27000000 /dev/zero >> q1-huge.pdf
echo '{"hello":"world"}' > q1-notes.json
schema='"$schema":"https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json"'
echo "{$schema,\"basics\":{\"label\":\"Designer\"}}" > q1-blank.json
echo "{$schema,\"basics\":{},\"work\":[{\"name\":\"Example Labs\",\"position\":\"Designer\",\"startDate\":\"2021-01-01\"}]}" > q1-nocontact.json
if adb -s "$udid" get-state >/dev/null 2>&1; then
	adb -s "$udid" push q1-*.pdf q1-*.json /sdcard/Download/ >/dev/null
	# The folder picker flows save into Documents (Android refuses the storage root).
	adb -s "$udid" shell mkdir -p /sdcard/Documents
	# Tell the media store, so the system picker lists them at once.
	for f in q1-*.pdf q1-*.json; do
		adb -s "$udid" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$f" >/dev/null
	done
	echo "Copied test files to Downloads on $udid"
	exit 0
fi
groups=~/Library/Developer/CoreSimulator/Devices/$udid/data/Containers/Shared/AppGroup
for group in "$groups"/*; do
	id=$(plutil -extract MCMMetadataIdentifier raw "$group/.com.apple.mobile_container_manager.metadata.plist" 2>/dev/null || true)
	if [ "$id" = "group.com.apple.FileProvider.LocalStorage" ]; then
		mkdir -p "$group/File Provider Storage"
		cp q1-*.pdf q1-*.json "$group/File Provider Storage/"
		echo "Copied test files to On My iPhone on $udid"
		exit 0
	fi
done
echo "Open the Files app once on $udid so On My iPhone exists, then run again." >&2
exit 1
