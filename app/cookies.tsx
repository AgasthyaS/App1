import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/** Cookies & Local Storage. Keep in step with every AsyncStorage key the app writes. */
export default function Cookies() {
  return (
    <LegalScreen
      title="Cookies & Local Storage"
      intro={`This policy explains what ${LEGAL.product} stores on your phone or in your browser, and why. It forms part of our Privacy Policy.`}
      summary={[
        'We use no advertising cookies and no third-party trackers.',
        'The app stores your sign-in, your garden and your settings on your device so it works and keeps you signed in.',
        'Usage counters are stored only if usage analytics is on, and you can switch it off.',
      ]}
      sections={[
        {
          heading: 'What we store and why',
          body: [
            'On the web, the app uses your browser’s local storage, which works like a cookie but is never sent automatically with web requests. On iOS and Android it uses the app’s private storage. We store:',
            '• Sign-in session (strictly necessary): keeps you signed in securely. Set by our authentication provider, Supabase.',
            '• Your garden and settings (strictly necessary): your plants, spots, sensors, care logs and preferences, so the app works offline and loads instantly.',
            '• Sensor and weather caches (strictly necessary): recent readings and forecasts, to avoid fetching them again.',
            '• Usage counters and an install identifier (analytics): a random identifier and counts of the screens you open and the buttons you tap. Written only while Settings → Usage analytics is on.',
          ],
        },
        {
          heading: 'What we don’t use',
          body: [
            'We do not use advertising cookies, cross-site tracking, fingerprinting, social-media pixels, or third-party analytics SDKs. Usage analytics is our own and stays in our own database.',
          ],
        },
        {
          heading: 'Your choices',
          body: [
            '• Turn off usage analytics in Settings → Data & privacy. On the web, a Global Privacy Control signal from your browser turns it off automatically.',
            '• Clear the counters on this device from Settings → Data & privacy → See what’s been recorded.',
            '• Signing out removes the sign-in session. Reset app, uninstalling, or clearing site data in your browser removes everything we stored on the device.',
            'Blocking strictly necessary storage will stop the app from working properly, for example you will not stay signed in.',
          ],
        },
        {
          heading: 'Changes',
          body: ['If we start storing a new category of information on your device, we will update this policy first.'],
        },
      ]}
    />
  );
}
