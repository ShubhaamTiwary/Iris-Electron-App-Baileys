#!/usr/bin/env node

/**
 * Standalone script to unregister iris:// protocol handlers
 * Can be run without Electron: node .erb/scripts/unregister-deeplinks-standalone.js
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

const PROTOCOL = 'iris';

console.log(`\n🔗 Unregistering ${PROTOCOL}:// protocol handlers...\n`);

const platform = process.platform;
let success = false;

/**
 * Unregister on macOS using Launch Services
 */
function unregisterOnMacOS() {
  try {
    console.log('Unregistering protocol handler on macOS...');

    // Method 1: Remove from LaunchServices database
    try {
      // Get all handlers for the protocol
      const result = execSync(
        `defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null || echo "[]"`,
        { encoding: 'utf-8' },
      );

      // Parse and filter out iris handlers
      const handlers = JSON.parse(result || '[]');
      const filteredHandlers = handlers.filter(
        (handler) => !(handler.LSHandlerURLScheme === PROTOCOL),
      );

      // Write back the filtered handlers
      if (filteredHandlers.length !== handlers.length) {
        execSync(
          `defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array ${filteredHandlers.map((h) => `'${JSON.stringify(h)}'`).join(' ')}`,
          { stdio: 'ignore' },
        );
        console.log('✓ Removed from LaunchServices database');
      }
    } catch (error) {
      // If defaults command fails, try alternative method
      console.log('  Trying alternative method...');
    }

    // Method 2: Use lsregister to reset
    try {
      execSync(
        `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user 2>/dev/null || true`,
        { stdio: 'ignore', timeout: 10000 },
      );
      console.log('✓ Reset LaunchServices database');
    } catch (error) {
      // lsregister might not be available or might timeout
      console.log('  (lsregister method skipped)');
    }

    // Restart Finder to apply changes
    try {
      execSync('killall Finder 2>/dev/null || true', { stdio: 'ignore' });
      console.log('✓ Restarted Finder to apply changes');
    } catch (error) {
      console.log(
        '  (Could not restart Finder - you may need to restart manually)',
      );
    }

    console.log('✅ macOS protocol handler unregistered');
    return true;
  } catch (error) {
    console.error('❌ Error unregistering on macOS:', error.message);
    return false;
  }
}

/**
 * Unregister on Windows using registry
 */
function unregisterOnWindows() {
  try {
    console.log('Unregistering protocol handler on Windows...');

    const registryPath = `HKEY_CURRENT_USER\\Software\\Classes\\${PROTOCOL}`;

    // Remove the protocol registry key
    try {
      execSync(`reg delete "${registryPath}" /f 2>nul`, { stdio: 'ignore' });
      console.log('✓ Removed registry entries');
    } catch (error) {
      // Registry key might not exist
      console.log('  (No registry entries found - already unregistered)');
    }

    // Also check for shell\open\command entries
    try {
      execSync(`reg delete "${registryPath}\\shell\\open\\command" /f 2>nul`, {
        stdio: 'ignore',
      });
    } catch {
      // Ignore if doesn't exist
    }

    try {
      execSync(`reg delete "${registryPath}\\shell\\open" /f 2>nul`, {
        stdio: 'ignore',
      });
    } catch {
      // Ignore if doesn't exist
    }

    try {
      execSync(`reg delete "${registryPath}\\shell" /f 2>nul`, {
        stdio: 'ignore',
      });
    } catch {
      // Ignore if doesn't exist
    }

    console.log('✅ Windows protocol handler unregistered');
    return true;
  } catch (error) {
    console.error('❌ Error unregistering on Windows:', error.message);
    return false;
  }
}

/**
 * Unregister on Linux
 */
function unregisterOnLinux() {
  try {
    console.log('Unregistering protocol handler on Linux...');

    const homeDir = os.homedir();
    const desktopFile = path.join(
      homeDir,
      '.local',
      'share',
      'applications',
      `${PROTOCOL}-protocol-handler.desktop`,
    );
    const mimeappsList = path.join(homeDir, '.config', 'mimeapps.list');

    // Remove desktop file if it exists
    try {
      const fs = require('fs');
      if (fs.existsSync(desktopFile)) {
        fs.unlinkSync(desktopFile);
        console.log('✓ Removed desktop file');
      } else {
        console.log('  (No desktop file found)');
      }
    } catch (error) {
      console.log('  (Could not remove desktop file)');
    }

    // Update mimeapps.list to remove the handler
    try {
      const fs = require('fs');
      if (fs.existsSync(mimeappsList)) {
        let content = fs.readFileSync(mimeappsList, 'utf-8');
        const lines = content.split('\n');
        const filteredLines = lines.filter(
          (line) => !line.includes(`${PROTOCOL}/x-scheme-handler/${PROTOCOL}`),
        );

        if (filteredLines.length !== lines.length) {
          fs.writeFileSync(mimeappsList, filteredLines.join('\n'));
          console.log('✓ Updated mimeapps.list');
        }
      }
    } catch (error) {
      console.log('  (Could not update mimeapps.list)');
    }

    // Update desktop database
    try {
      execSync(
        'update-desktop-database ~/.local/share/applications 2>/dev/null || true',
        {
          stdio: 'ignore',
        },
      );
      console.log('✓ Updated desktop database');
    } catch (error) {
      console.log('  (update-desktop-database not available)');
    }

    console.log('✅ Linux protocol handler unregistered');
    return true;
  } catch (error) {
    console.error('❌ Error unregistering on Linux:', error.message);
    return false;
  }
}

// Main execution
switch (platform) {
  case 'darwin':
    success = unregisterOnMacOS();
    break;
  case 'win32':
    success = unregisterOnWindows();
    break;
  case 'linux':
    success = unregisterOnLinux();
    break;
  default:
    console.log(`⚠️  Platform ${platform} not specifically handled`);
    console.log('  You may need to manually unregister the protocol handler');
    success = false;
}

if (success) {
  console.log(
    `\n✅ Successfully unregistered ${PROTOCOL}:// protocol handlers`,
  );
  console.log('  You can now register the new handler by running your app.\n');
} else {
  console.log(`\n⚠️  Some operations may have failed`);
  console.log(
    '  If issues persist, you may need to manually unregister the protocol handler.\n',
  );
}

process.exit(success ? 0 : 1);
