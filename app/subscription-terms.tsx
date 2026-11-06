import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/** Greenr+ Subscription Terms — part of the Terms of Service. */
export default function SubscriptionTerms() {
  return (
    <LegalScreen
      title="Greenr+ Subscription Terms"
      intro={`These terms cover Greenr+, the optional paid subscription for ${LEGAL.product}. They form part of our Terms of Service.`}
      summary={[
        'Greenr+ is billed monthly or yearly through your Apple or Google account.',
        'It renews automatically until you cancel, and you can cancel any time in your app-store settings.',
        'If you cancel, you keep Greenr+ until the end of the period you paid for, and your garden data is never deleted.',
      ]}
      sections={[
        {
          heading: 'What’s included',
          body: [
            'Greenr+ unlocks extra features, such as longer forecasts and crisis prediction, full history, photo diagnosis and autopsies, unlimited plants and spots, the in-store scanner, and accuracy detail with CSV export. The current list is shown on the Greenr+ screen before you buy. Features may improve over time. We will not take away a core advertised feature during a period you have already paid for.',
          ],
        },
        {
          heading: 'Price and billing',
          body: [
            'The price, currency and billing period are shown before you confirm a purchase, and include any applicable taxes where required. Payment is charged to your Apple ID or Google Play account when you confirm. We never see or store your payment card.',
          ],
        },
        {
          heading: 'Automatic renewal',
          body: [
            'Your subscription renews automatically at the end of each billing period, at the then-current price, unless you cancel at least 24 hours before the period ends. Your account is charged for renewal within the 24 hours before the current period ends.',
          ],
        },
        {
          heading: 'Free trials and offers',
          body: [
            'If we offer a free trial or introductory price, its length and the price afterwards are shown before you start. Unless you cancel at least 24 hours before the trial ends, it converts to a paid subscription. Each person can have one trial.',
          ],
        },
        {
          heading: 'Cancelling',
          body: [
            '• iPhone or iPad: Settings → your name → Subscriptions → Greenr → Cancel Subscription.',
            '• Android: Google Play → profile → Payments & subscriptions → Subscriptions → Greenr → Cancel.',
            'Deleting the app or your Greenr account does not cancel an app-store subscription by itself. Please cancel it in the store too.',
          ],
        },
        {
          heading: 'Refunds',
          body: [
            'Purchases are handled by Apple or Google, and refund requests go through their processes (reportaproblem.apple.com, or Google Play’s order history). Under their policies, payments are generally non-refundable for partly used periods unless the law requires otherwise. If you are in the EEA or UK, you may have a statutory right to withdraw within 14 days. By starting to use Greenr+ straight away, you agree that this right ends once the service has been fully provided, as the law allows.',
          ],
        },
        {
          heading: 'Price changes',
          body: [
            'If we raise the price, you will be told in advance by the app store and, where required, asked to agree. If you do not agree, the subscription ends at the close of the current period.',
          ],
        },
        {
          heading: 'When Greenr+ ends',
          body: [
            'Your plants, history and photos stay in your account. Greenr+ features stop working until you resubscribe. If you have more plants than the free plan allows, you keep all of them, and Greenr may limit some features until you are back within the free limits.',
          ],
        },
        {
          heading: 'Restoring purchases',
          body: [
            'Signed in on a new device? Use "Restore" on the Greenr+ screen to reconnect an active subscription bought with the same app-store account.',
          ],
        },
      ]}
    />
  );
}
