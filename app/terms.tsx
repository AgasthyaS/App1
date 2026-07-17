import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';

/** Terms of Service. Plain-language, prototype-honest. */
export default function Terms() {
  return (
    <LegalScreen
      title="Terms of Service"
      effective="July 16, 2026"
      intro="These terms govern your use of the Greenr app and any paired Greenr sensors. By using Greenr, you agree to them. Please read them alongside our Privacy Policy."
      sections={[
        {
          heading: 'Using Greenr',
          body: [
            'We grant you a personal, non-transferable licence to use the app to care for your own plants. You agree to use it lawfully and not to misuse it — for example, by attempting to break its security, disrupt the service, or access data that is not yours.',
          ],
        },
        {
          heading: 'Your account and data',
          body: [
            'You are responsible for the activity under your account and for keeping your sign-in secure. You retain ownership of the garden data and photos you add; you grant us only the limited permission needed to store, process, and display them back to you so the app can function.',
          ],
        },
        {
          heading: 'Greenr+ subscription',
          body: [
            'Some features are part of Greenr+, a paid subscription. Free accounts can track up to 3 plants; Greenr+ removes that limit and unlocks additional features such as photo diagnosis. Prices, billing periods, and included features are shown at purchase. Subscriptions renew automatically unless cancelled, and are managed through your app-store account, where you can also cancel.',
          ],
        },
        {
          heading: 'Sensors and hardware',
          body: [
            'Greenr sensors are optional. Readings depend on correct placement, calibration, power, and network conditions, and are estimates — not laboratory measurements. Keep sensors on reliable power; a computer USB port that sleeps will interrupt reporting. Follow any safety guidance included with the hardware.',
          ],
        },
        {
          heading: 'Guidance is advisory',
          body: [
            'Greenr provides estimates and recommendations to help you care for plants. They are informational only and not a guarantee of any outcome. Plants are living things affected by many factors we cannot measure. You are responsible for your own watering, placement, and care decisions, and should use your judgement — especially around toxicity where pets or children may be present.',
          ],
        },
        {
          heading: 'Availability',
          body: [
            'We work to keep Greenr reliable but do not promise it will be uninterrupted or error-free. Features may change, and we may add, modify, or discontinue parts of the service over time.',
          ],
        },
        {
          heading: 'Disclaimers and liability',
          body: [
            'To the fullest extent permitted by law, Greenr is provided "as is" without warranties of any kind, and we are not liable for indirect or consequential damages, or for plant loss or damage, arising from your use of the app or sensors. Nothing in these terms limits rights that cannot be limited by law.',
          ],
        },
        {
          heading: 'Termination',
          body: [
            'You may stop using Greenr and delete your account at any time. We may suspend or end access if these terms are seriously or repeatedly breached.',
          ],
        },
        {
          heading: 'Changes to these terms',
          body: [
            'We may update these terms as the app develops. Material changes will be posted here with a new effective date, and continued use after that means you accept the updated terms.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Questions about these terms? Email support@greenr.app.',
          ],
        },
      ]}
    />
  );
}
