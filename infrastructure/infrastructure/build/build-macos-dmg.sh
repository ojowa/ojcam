#!/bin/bash
# macOS DMG Installer Build Script
set -e

PROJECT_NAME="Ojowacam Desktop"
VERSION="1.0.0"
BUILD_DIR=".build/release"
DMG_NAME="Ojowacam-Desktop-${VERSION}.dmg"
VOLUME_NAME="Ojowacam Desktop"
TEMP_DMG="Ojowacam-temp.dmg"
FINAL_DMG="${DMG_NAME}"

# Signing identity (configure in CI or local environment)
SIGNING_IDENTITY="${MACOS_SIGNING_IDENTITY:-}"
NOTARIZATION_APPLE_ID="${NOTARIZATION_APPLE_ID:-}"
NOTARIZATION_TEAM_ID="${NOTARIZATION_TEAM_ID:-}"

echo "=== Building Ojowacam macOS Installer ==="
echo "Version: ${VERSION}"
echo ""

# Step 1: Build the application
echo "Step 1: Building application..."
swift build -c release

# Step 2: Sign the application binary
if [ -n "$SIGNING_IDENTITY" ]; then
    echo "Step 2: Signing application..."
    codesign --deep --force --sign "${SIGNING_IDENTITY}" \
        "${BUILD_DIR}/${PROJECT_NAME}"
    
    # Verify signature
    codesign --verify --deep --display "${BUILD_DIR}/${PROJECT_NAME}"
else
    echo "Step 2: Skipping code signing (no signing identity provided)"
fi

# Step 3: Create staging directory
echo "Step 3: Creating staging directory..."
rm -rf staging
mkdir -p staging
cp -R "${BUILD_DIR}/${PROJECT_NAME}.app" staging/

# Step 4: Create Applications symlink
ln -s /Applications staging/Applications

# Step 5: Create temporary DMG
echo "Step 5: Creating DMG..."
hdiutil create -srcfolder staging -volname "${VOLUME_NAME}" \
    -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format UDRW -o "${TEMP_DMG}"

# Step 6: Mount DMG to add custom icon/background
echo "Step 6: Mounting DMG for customization..."
DEVICE=$(hdiutil attach -readwrite -noverify "${TEMP_DMG}" | grep -o '/dev/disk[0-9]*')
sleep 2

# Add background image if available
if [ -f "infrastructure/installers/dmg-background.png" ]; then
    mkdir -p /Volumes/"${VOLUME_NAME}"/.background
    cp infrastructure/installers/dmg-background.png /Volumes/"${VOLUME_NAME}"/.background/
fi

# Step 7: Unmount and convert to final compressed DMG
hdiutil detach "${DEVICE}"
hdiutil convert "${TEMP_DMG}" -format UDZO -o "${FINAL_DMG}"
rm -f "${TEMP_DMG}"
rm -rf staging

# Step 8: Notarize (if credentials provided)
if [ -n "$NOTARIZATION_APPLE_ID" ] && [ -n "$NOTARIZATION_TEAM_ID" ]; then
    echo "Step 7: Notarizing DMG..."
    xcrun notarytool submit "${FINAL_DMG}" \
        --apple-id "${NOTARIZATION_APPLE_ID}" \
        --team-id "${NOTARIZATION_TEAM_ID}" \
        --wait
    
    # Staple the ticket
    xcrun stapler staple "${FINAL_DMG}"
fi

# Step 9: Verify final DMG
echo "Step 8: Verifying DMG..."
hdiutil imageinfo "${FINAL_DMG}"

echo ""
echo "=== Build Complete ==="
echo "Output: ${FINAL_DMG}"
echo "Size: $(du -h "${FINAL_DMG}" | cut -f1)"
