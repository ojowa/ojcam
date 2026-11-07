#!/bin/bash
# Ojowacam OBS Plugin - Runtime Test Script (macOS Bash)
# Run this on a Mac with OBS Studio 30.1.2+ installed
#
# Usage:
#   chmod +x test-obs-plugin.sh
#   ./test-obs-plugin.sh -PluginPath "$PWD/apps/obs-plugin/build/data/obs-plugins/ojowacam-obs"

set -euo pipefail

PLUGIN_PATH="${1:-$PWD/apps/obs-plugin/build/data/obs-plugins/ojowacam-obs}"
OBS_EXE="/Applications/Obs Studio.app/Contents/MacOS/Obs Studio"
OBS_PLUGINS_DIR="$HOME/Library/Application Support/obs-studio/plugins/ojowacam-obs"
OBS_LOG="$HOME/Library/Application Support/obs-studio/logs/obs.log"

PASSED=0
FAILED=0
RESULTS_FILE="$PWD/obs-plugin-test-results.csv"

echo "========================================"
echo "Ojowacam OBS Plugin - Runtime Test Suite (macOS)"
echo "========================================"
echo ""

pass() { echo "[PASS] $1" | tee -a "$RESULTS_FILE"; PASSED=$((PASSED+1)); }
fail() { echo "[FAIL] $1" | tee -a "$RESULTS_FILE"; FAILED=$((FAILED+1)); }

# TEST 1: Plugin files exist
echo "Test 1: Plugin files exist"
if [[ -f "$PLUGIN_PATH/ojowacam-obs.bundle" && -f "$PLUGIN_PATH/module.json" ]]; then
    DLL_SIZE=$(stat -f%z "$PLUGIN_PATH/ojowacam-obs.bundle" 2>/dev/null || echo "N/A")
    pass "Plugin bundle and module.json exist (bundle: $DLL_SIZE bytes)"
    
    if python3 -c "import json; json.load(open('$PLUGIN_PATH/module.json'))" 2>/dev/null; then
        pass "module.json is valid JSON"
    else
        fail "module.json is not valid JSON"
    fi
else
    fail "Plugin bundle and module.json exist (bundle: $([ -f "$PLUGIN_PATH/ojowacam-obs.bundle" ] && echo yes || echo no), json: $([ -f "$PLUGIN_PATH/module.json" ] && echo yes || echo no))"
fi

# TEST 2: OBS Studio installed
echo ""
echo "Test 2: OBS Studio installation"
if [[ -f "$OBS_EXE" ]]; then
    pass "OBS Studio executable found: $OBS_EXE"
else
    # Try alternative paths
    ALT_PATHS=(
        "$HOME/Applications/Obs Studio.app/Contents/MacOS/Obs Studio"
        "/Applications/OBS Studio.app/Contents/MacOS/Obs Studio"
    )
    FOUND=false
    for p in "${ALT_PATHS[@]}"; do
        if [[ -f "$p" ]]; then
            OBS_EXE="$p"
            pass "OBS Studio executable found: $p"
            FOUND=true
            break
        fi
    done
    if [[ "$FOUND" == "false" ]]; then
        fail "OBS Studio executable not found at $OBS_EXE or alternatives"
    fi
fi

# TEST 3: Install plugin
echo ""
echo "Test 3: Install plugin to OBS plugins folder"
if [[ -f "$OBS_EXE" ]]; then
    mkdir -p "$OBS_PLUGINS_DIR"
    cp -f "$PLUGIN_PATH/"* "$OBS_PLUGINS_DIR/" 2>/dev/null || true
    
    if [[ -f "$OBS_PLUGINS_DIR/module.json" ]]; then
        pass "Plugin installed to OBS plugins folder: $OBS_PLUGINS_DIR"
    else
        fail "Plugin installed to OBS plugins folder (copy failed)"
    fi
else
    fail "Plugin installed to OBS plugins folder (OBS not found)"
fi

# TEST 4: Launch OBS
echo ""
echo "Test 4: Launch OBS and verify plugin loads"
if [[ -f "$OBS_EXE" && -d "$OBS_PLUGINS_DIR" ]]; then
    "$OBS_EXE" &
    OBS_PID=$!
    sleep 10
    
    if kill -0 "$OBS_PID" 2>/dev/null; then
        pass "OBS Studio launches successfully (PID: $OBS_PID)"
        
        if [[ -f "$OBS_LOG" ]]; then
            LOG_CONTENT=$(cat "$OBS_LOG")
            if echo "$LOG_CONTENT" | grep -qi "ojowacam"; then
                if echo "$LOG_CONTENT" | grep -qi "ojowacam.*error\|error.*ojowacam"; then
                    fail "Ojowacam plugin loads in OBS (errors found in log)"
                else
                    pass "Ojowacam plugin loads in OBS (no errors)"
                fi
            else
                fail "Ojowacam plugin loads in OBS (no Ojowacam messages in log)"
            fi
        else
            fail "OBS log file exists (not found at $OBS_LOG)"
        fi
        
        kill "$OBS_PID" 2>/dev/null || true
        sleep 3
    else
        fail "OBS Studio launches successfully (process exited)"
    fi
else
    fail "OBS Studio launches with plugin (prerequisites not met)"
fi

# TEST 5: Source registration
echo ""
echo "Test 5: Verify Ojowacam sources registered"
if [[ -f "$OBS_LOG" ]]; then
    if grep -qi "ojowacam_video_source\|Ojowacam Video" "$OBS_LOG" && grep -qi "ojowacam_audio_source\|Ojowacam Microphone" "$OBS_LOG"; then
        pass "Ojowacam Video and Microphone sources registered"
    elif grep -qi "ojowacam_video_source\|Ojowacam Video" "$OBS_LOG"; then
        pass "Ojowacam Video source registered"
        fail "Ojowacam Microphone source registered"
    elif grep -qi "ojowacam_audio_source\|Ojowacam Microphone" "$OBS_LOG"; then
        fail "Ojowacam Video source registered"
        pass "Ojowacam Microphone source registered"
    else
        fail "Ojowacam sources registered (neither found in log)"
    fi
else
    fail "Ojowacam sources registered (OBS log not available)"
fi

# TEST 6: Clean uninstall
echo ""
echo "Test 6: Clean uninstall"
if [[ -d "$OBS_PLUGINS_DIR" ]]; then
    rm -rf "$OBS_PLUGINS_DIR"
    if [[ ! -d "$OBS_PLUGINS_DIR" ]]; then
        pass "Plugin folder removed cleanly"
    else
        fail "Plugin folder removed cleanly"
    fi
else
    fail "Plugin folder removed cleanly (folder does not exist)"
fi

# Summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total:  $((PASSED + FAILED))"
echo ""

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi