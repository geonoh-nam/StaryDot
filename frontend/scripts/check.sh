#!/bin/sh
# Everything that can fail without a device. Run before handing a change to the tablet.
set -e
cd "$(dirname "$0")/.."
FILES="App.js Puzzle.js Typography.js sound.js theme.js age.js data/*.js ui/*.js screens/*.js activities/*.js"
node scripts/undef-check.js $FILES
node scripts/style-check.js $FILES
node activities/test.js
echo "checks passed"
