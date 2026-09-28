import 'package:flutter_test/flutter_test.dart';
import 'package:ores_common_mobile_host/ores_common_mobile_host.dart';

void main() {
  test('mobile host config accepts a valid encrypted relay', () {
    final config = MobileHostConfig(
      productId: 'scintilla',
      deviceId: 'device-1',
      originPort: 18080,
      mode: MobileHostingMode.persistentOrigin,
      relayUrl: Uri.parse('https://relay.example.com/device'),
    );

    expect(config.validate, returnsNormally);
  });

  test('invalid origin port is rejected', () {
    final config = MobileHostConfig(
      productId: 'beamscale',
      deviceId: 'device-2',
      originPort: 70000,
      mode: MobileHostingMode.wakeAndDrain,
      relayUrl: Uri.parse('https://relay.example.com/device'),
    );

    expect(config.validate, throwsArgumentError);
  });

  test('plaintext relay endpoints are rejected', () {
    final config = MobileHostConfig(
      productId: 'scintilla',
      deviceId: 'device-3',
      originPort: 18080,
      mode: MobileHostingMode.persistentOrigin,
      relayUrl: Uri.parse('http://relay.example.com/device'),
    );

    expect(config.validate, throwsArgumentError);
  });

  test('relay URLs with embedded credentials are rejected', () {
    final config = MobileHostConfig(
      productId: 'scintilla',
      deviceId: 'device-4',
      originPort: 18080,
      mode: MobileHostingMode.persistentOrigin,
      relayUrl: Uri.parse('https://user:pass@relay.example.com/device'),
    );

    expect(config.validate, throwsArgumentError);
  });

  test('platform capabilities remain explicit', () {
    const capabilities = MobileHostCapabilities(
      platform: 'ios',
      supportsPersistentOrigin: false,
      supportsWakeAndDrain: true,
      supportsBackgroundPush: true,
      minimumRepairWakeMinutes: null,
    );

    expect(capabilities.supportsPersistentOrigin, isFalse);
    expect(capabilities.supportsWakeAndDrain, isTrue);
  });
}
