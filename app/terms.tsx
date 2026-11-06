import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/** Terms of Service. The other policies in lib/legal.ts form part of these terms. */
export default function Terms() {
  return (
    <LegalScreen
      title="Terms of Service"
      intro={`These terms are an agreement between you and ${LEGAL.operator} covering your use of the ${LEGAL.product} apps, the web app, and Greenr sensors (together, the "Service"). By creating an account, continuing as a guest, or otherwise using the Service, you agree to them. Please read them together with our Privacy Policy.`}
      summary={[
        'Use Greenr to care for your own plants, lawfully, and don’t abuse the service.',
        'Your garden data and photos stay yours.',
        'Greenr’s advice is our best estimate, not a guarantee. You make the final call for your plants, pets and family.',
        'Greenr+ renews automatically until you cancel through your app store.',
        'Nothing here takes away rights you have by law as a consumer.',
      ]}
      sections={[
        {
          heading: 'The agreement',
          body: [
            'These terms include the Acceptable Use Policy, the Greenr+ Subscription Terms, and the Sensor Warranty & Safety terms, each available in the app under Legal. If those documents and these terms conflict on a specific topic, the more specific document applies to that topic.',
          ],
        },
        {
          heading: 'Who can use Greenr',
          body: [
            `You must be at least ${LEGAL.minimumAge}, or the minimum age to consent to data processing where you live if that is higher, to use the Service. If you are under the age of majority, a parent or guardian must agree to these terms for you. You may not use the Service if the law prohibits it.`,
          ],
        },
        {
          heading: 'Your account',
          body: [
            'You are responsible for activity under your account and for keeping your sign-in methods secure. Tell us promptly if you think someone else has accessed it. A guest garden lives only on your device: if you reset the app or lose the device, it cannot be recovered.',
          ],
        },
        {
          heading: 'Our licence to you',
          body: [
            'Subject to these terms, we grant you a personal, limited, non-exclusive, non-transferable, revocable licence to use the Service for your own non-commercial plant care. The app, its software, models, design, text and trademarks belong to us or our licensors, and these terms do not give you any ownership of them.',
          ],
        },
        {
          heading: 'Your content',
          body: [
            'You keep ownership of the plants, notes, photos and other content you add ("Your Content"). You give us a worldwide, royalty-free licence to host, store, copy, process and display Your Content only as needed to run the Service for you and for the people you choose to share your garden with. This licence ends when you delete the content or your account, except for copies in backups on their normal rotation.',
            'You confirm that you have the right to upload Your Content and that it does not break the law or anyone else’s rights.',
            'If you send us feedback or suggestions, we may use them without obligation to you.',
          ],
        },
        {
          heading: 'Acceptable use',
          body: [
            'You agree to follow the Acceptable Use Policy. In short: no unlawful use, no attacking or overloading the Service, no accessing other people’s data, and no interfering with sensors or the research dataset.',
          ],
        },
        {
          heading: 'Greenr+',
          body: [
            'Some features need a paid Greenr+ subscription. Purchases, automatic renewal, cancellation and refunds are covered by the Greenr+ Subscription Terms and by the terms of the app store you buy through.',
          ],
        },
        {
          heading: 'Greenr sensors',
          body: [
            'Sensors are optional hardware. Their use, safety guidance, firmware updates and the limited warranty are covered by the Sensor Warranty & Safety terms. Readings are estimates that depend on placement, calibration, power and connectivity. They are not laboratory measurements.',
          ],
        },
        {
          heading: 'Advice is informational',
          body: [
            'Greenr gives estimates, forecasts and recommendations to help you care for plants. They are informational only and are not professional horticultural, veterinary, medical or safety advice. Plants are living things affected by factors we cannot measure, and outcomes are not guaranteed.',
            'You are responsible for your own watering, placement, pest treatment and care decisions. Plant toxicity information may be incomplete: always check with a qualified source before keeping a plant around pets or children, and in an emergency contact a doctor, vet or poison-control service.',
          ],
        },
        {
          heading: 'Third-party services',
          body: [
            'The Service relies on third parties, including Supabase, Vercel, Open-Meteo, Google and the app stores. Their services are governed by their own terms, and we are not responsible for them. Weather data is provided by Open-Meteo.',
          ],
        },
        {
          heading: 'Changes to the Service',
          body: [
            'We are continually improving Greenr and may add, change or remove features. If we discontinue the Service entirely, we will give reasonable notice where practical so you can export your data. If you have prepaid for Greenr+, you may be entitled to a pro-rata refund.',
          ],
        },
        {
          heading: 'Suspension and termination',
          body: [
            'You may stop using the Service and delete your account at any time from Settings. We may suspend or end your access if you seriously or repeatedly breach these terms, if we must do so by law, or to protect the Service or other users. Where reasonable, we will tell you why first and give you a chance to export your data. Sections that by their nature should survive termination will survive.',
          ],
        },
        {
          heading: 'Disclaimers',
          body: [
            'To the fullest extent the law allows, the Service is provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement. We do not promise the Service will be uninterrupted, error-free, or that any plant will survive. The limited hardware warranty in the Sensor Warranty & Safety terms still applies.',
          ],
        },
        {
          heading: 'Limitation of liability',
          body: [
            'To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for loss of plants, data, profits or goodwill, arising from your use of the Service. Our total liability for any claim relating to the Service is limited to the greater of the amount you paid us in the 12 months before the claim, or US$50.',
            'Nothing in these terms excludes or limits liability that cannot be excluded by law, such as liability for death or personal injury caused by negligence, for fraud, or your statutory rights as a consumer.',
          ],
        },
        {
          heading: 'Indemnity',
          body: [
            'If you use the Service for business purposes, you agree to indemnify us against third-party claims arising from your breach of these terms or your misuse of the Service. This does not apply to consumers where the law does not allow it.',
          ],
        },
        {
          heading: 'Governing law and disputes',
          body: [
            `These terms are governed by the laws of ${LEGAL.jurisdiction}, without regard to conflict-of-law rules, and disputes will be heard in its courts. If you are a consumer, you also keep the protection of the mandatory laws of the country where you live, and you may bring claims in your local courts. Before filing a claim, please contact us so we can try to resolve it informally within 30 days.`,
          ],
        },
        {
          heading: 'Apple App Store terms',
          body: [
            'If you downloaded Greenr from the Apple App Store: these terms are between you and us, not Apple. Apple has no obligation to provide maintenance or support for the app. If the app fails to meet an applicable warranty, you may notify Apple for a refund of the purchase price, and Apple has no other warranty obligation. Apple is not responsible for handling claims relating to the app, including product liability, legal or regulatory compliance, consumer-protection claims, or intellectual property infringement claims. You confirm you are not in a country subject to a US Government embargo and are not on a US Government list of prohibited or restricted parties. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.',
          ],
        },
        {
          heading: 'Changes to these terms',
          body: [
            'We may update these terms. If a change is material, we will tell you in the app at least 14 days before it takes effect, unless it is needed sooner for legal or security reasons. If you keep using the Service after a change takes effect, you accept the updated terms. If you do not agree, you may stop using the Service and delete your account.',
          ],
        },
        {
          heading: 'General',
          body: [
            'If any part of these terms is unenforceable, the rest stays in effect. Our not enforcing a term is not a waiver. You may not transfer these terms without our consent. We may transfer them in connection with a merger, acquisition or sale of assets. These terms are the entire agreement between you and us about the Service.',
          ],
        },
        {
          heading: 'Contact',
          body: [`Questions about these terms: ${LEGAL.supportEmail}.`],
        },
      ]}
    />
  );
}
