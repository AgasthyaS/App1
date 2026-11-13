import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/**
 * Privacy Policy. Every claim here should be true of the code — when a data
 * flow changes (a new table, provider, or analytics event type), update this.
 */
export default function PrivacyPolicy() {
  return (
    <LegalScreen
      title="Privacy Policy"
      intro={`${LEGAL.product} helps you care for your plants. This policy explains what information the app and Greenr sensors collect, why, who it is shared with, how long it is kept, and the choices and rights you have. It applies to the ${LEGAL.product} apps for iOS and Android, the web app at ${LEGAL.webUrl}, and Greenr sensors.`}
      summary={[
        'We collect what the app needs to work: your account, your garden, and your sensor readings.',
        'We count which screens you open and which buttons you tap, to learn what to improve. Never what you type, your plant names, photos, or location. You can turn this off in Settings.',
        'With your permission, de-identified care data helps improve plant-care models. You can turn this off too.',
        'A plant photo goes to Google’s AI service only when you ask Greenr to identify the plant. We do not store it.',
        'We never sell your personal information or use it for advertising.',
        'You can see, export, and delete your data from inside the app at any time.',
      ]}
      sections={[
        {
          heading: 'Who we are',
          body: [
            `${LEGAL.operator} ("we", "us") operates ${LEGAL.product} and is the controller responsible for your personal information. You can reach us at ${LEGAL.privacyEmail} or ${LEGAL.address}.`,
          ],
        },
        {
          heading: 'Information you give us',
          body: [
            '• Account: your email address and how you signed in (Google, an emailed one-time link, or as a guest). If you use Google, we receive your name and email address from Google. We never see your Google password.',
            '• Profile and onboarding answers: the name you go by, your gardening experience, how many plants you have, whether you grow indoors or outdoors, and what you find hardest. We use these to tailor tips.',
            '• Your garden: the plants, rooms and spots you add, their pots and soil, your care logs (waterings, feedings, repots, growth entries), notes, and any photos you take or choose. Photos are stored as part of your garden.',
            '• Photo identification: if you choose to identify a plant from a photo, that photo is sent to our server and on to Google’s Gemini service, which suggests a species. We do not keep the photo on our servers. We keep the suggestion, which one you accepted, and a fingerprint of the image so the same photo is not processed twice. Photos you take without using identification stay in your garden only.',
            '• What you observe: notes you record about how a plant looks, such as new growth, yellowing or pests.',
            '• Household sharing: if you invite someone to your garden, the email address you enter for them.',
            '• Messages: anything you send us when you contact support.',
          ],
        },
        {
          heading: 'Information collected automatically',
          body: [
            '• Sensor readings: Greenr sensors report soil moisture, light, temperature, humidity and battery level, along with the sensor’s identifier, firmware version, battery voltage, Wi-Fi signal strength, check-in interval and the time it was last seen.',
            '• Wi-Fi setup: when you connect a sensor to Wi-Fi, your network name and password go over Bluetooth straight to the sensor. They are not sent to our servers.',
            `• Usage analytics: the names of the screens you open (for example "briefing" or "plant detail"), which named buttons you tap (for example "weekly briefing" on the Today screen), and core actions such as logging a watering. Each event carries a timestamp, your platform (iOS, Android or web), the app version, a random install identifier, and your account identifier if you are signed in. Analytics never records what you type, plant names, notes, photos, email addresses or location.`,
            '• Advice history: the watering advice the app gave for each plant, the readings it was based on, and whether a watering followed. This lets the app check its own advice against what happened.',
            '• Technical data: like any internet service, our hosting providers receive your IP address and basic device and browser information when the app connects to them. They use it to deliver the service and keep it secure.',
          ],
        },
        {
          heading: 'Location',
          body: [
            'Location is optional and is requested only when you use a feature that needs it: outdoor weather, or suggesting plants for your climate. You can say no and choose your climate by hand.',
            'When you allow it, your device works out an approximate position. For weather, those coordinates are sent to our weather provider, Open-Meteo, to get a forecast. To suggest plants, the coordinates are turned into a region name using your device’s built-in geocoding service, provided by Apple or Google. We do not store your coordinates on our servers or keep a location history. Our research data includes only a broad climate zone hundreds of miles wide.',
          ],
        },
        {
          heading: 'Plant-care research (optional)',
          body: [
            'If "Anonymized research" is on in Settings, the app sends de-identified care data: each plant’s species and pot setup, waterings and how the soil responded, measured pot behaviour, periodic health scores, and your broad climate zone. Plant names, notes, photos and coordinates are never included.',
            'These records are kept with your account so we can honour your choices. Turning research off, or deleting your account, stops further uploads. Other users only ever see this data as aggregate statistics, such as how a species tends to do in a climate zone, never as individual records.',
          ],
        },
        {
          heading: 'How we use information',
          body: [
            '• To provide the app: syncing your garden across devices, working out health and watering recommendations, showing your history, and scheduling the reminders you turn on.',
            '• To improve the app: understanding which features are used and where people get stuck (usage analytics), and improving our care models (research, if you allow it).',
            '• To keep it secure: preventing abuse, debugging, and protecting accounts.',
            '• To communicate with you: sign-in links, replies to support requests, and important service or policy notices. We do not send marketing email without your consent.',
            'We do not sell your personal information, "share" it for cross-context behavioural advertising, or use it to build advertising profiles. We do not make automated decisions that have legal or similarly significant effects on you. A species suggested from a photo is a suggestion: nothing changes until you confirm it.',
          ],
        },
        {
          heading: 'Legal bases (EEA, UK and Switzerland)',
          body: [
            '• Contract: to provide the account, sync, sensors and features you asked for.',
            '• Legitimate interests: usage analytics, security and product improvement. These are limited to non-identifying event names, and you can object at any time by turning analytics off.',
            '• Consent: location, camera, photo library, notifications and plant-care research. You can withdraw consent at any time in Settings or your device settings. Withdrawing does not affect processing that already happened.',
            '• Legal obligation: where we must keep or disclose information to comply with the law.',
          ],
        },
        {
          heading: 'Who we share it with',
          body: [
            '• Supabase: our authentication and cloud database. It stores your account, garden, sensor readings, research records and usage events, and sends sign-in emails.',
            '• Vercel: hosts the web app.',
            '• Open-Meteo: receives coordinates to return weather, only when you use weather features.',
            '• Google: if you choose Google sign-in, and to process a photo when you use photo identification (Gemini API).',
            '• Apple and Google app stores: process subscription purchases. We receive confirmation of your subscription, never your payment card.',
            '• People you invite: household members can see the garden you share with them.',
            '• Legal and safety: if required by law, or to protect the rights, safety or property of our users, the public or us.',
            '• Business transfers: if we are involved in a merger, acquisition or sale of assets, information may transfer under this policy, and we will tell you before it becomes subject to a different policy.',
            'Our service providers process data only on our instructions and may not use it for their own purposes.',
          ],
        },
        {
          heading: 'On-device storage and cookies',
          body: [
            'The app stores your session, garden, settings and usage counters on your device so it works offline and keeps you signed in. On the web this uses browser local storage. We use no advertising or third-party tracking cookies. See the Cookies & Local Storage policy for details.',
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            '• Account, garden and sensor data: while your account is active. Deleted when you delete your account.',
            `• Usage analytics: raw events are deleted automatically after ${LEGAL.analyticsRetentionMonths} months, or sooner if you delete them from the Usage screen or delete your account.`,
            '• Research records: until you delete your account. Aggregate statistics that no longer relate to you may be kept.',
            '• Guest gardens: only on your device, until you reset the app or uninstall it.',
            '• Backups and logs kept by our providers are overwritten on their normal schedule, usually within 30 days.',
            'We may keep limited records longer where the law requires, for example purchase records for tax.',
          ],
        },
        {
          heading: 'Security',
          body: [
            'Data travels over encrypted connections (TLS). Every database table is protected by row-level security, so an account can reach only its own data and the gardens shared with it. You can add two-factor sign-in under Security & privacy. No system is perfectly secure. If a breach affects your personal information, we will notify you and the authorities as the law requires.',
          ],
        },
        {
          heading: 'Your choices in the app',
          body: [
            '• Usage analytics: Settings → Data & privacy → Usage analytics. "See what’s been recorded" shows every count kept on your device and lets you delete what was uploaded.',
            '• Research: Settings → Data & privacy → Anonymized research.',
            '• Export: Settings → Data & privacy → Export all data (JSON).',
            '• Delete: Settings → Account → Delete account. See Delete Your Data.',
            '• Permissions: camera, photos, location, Bluetooth and notifications are each requested only when needed and can be revoked in your device settings.',
            '• Global Privacy Control: on the web, if your browser sends a GPC signal, we treat it as an opt-out of usage analytics.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'Depending on where you live, you may have the right to access, correct, delete or export your personal information, to restrict or object to how it is used, and to withdraw consent. Most of these you can do yourself in the app. For anything else, email us. We will respond within 30 days, or within the time your local law sets.',
            '• EEA, UK and Switzerland: you may also complain to your local data protection authority.',
            '• California (CCPA/CPRA) and other US states with privacy laws: you have the right to know what we collect and how we use it, to delete and correct it, and to opt out of sale, sharing and targeted advertising (we do none of these). We will not treat you differently for using your rights. You may use an authorised agent. If we decline a request, you may appeal by replying to our decision.',
            'We may need to verify your identity before acting on a request, normally by having you confirm it from the email address on your account.',
          ],
        },
        {
          heading: 'International transfers',
          body: [
            'Our providers may process data in countries other than yours, including the United States. Where the law requires, we rely on safeguards such as the European Commission’s Standard Contractual Clauses to protect it.',
          ],
        },
        {
          heading: "Children's privacy",
          body: [
            `${LEGAL.product} is not directed to children under ${LEGAL.minimumAge} (or the minimum age in your country, such as 16 in parts of the EEA), and we do not knowingly collect their personal information. If you believe a child has given us information, contact us and we will delete it.`,
          ],
        },
        {
          heading: 'Changes to this policy',
          body: [
            'We will update this policy when our practices change. The effective date above shows when it was last revised. If a change is material, for example a new purpose or a new kind of data, we will tell you in the app before it takes effect and, where the law requires, ask for your consent again.',
          ],
        },
        {
          heading: 'Contact',
          body: [`Questions or requests about privacy: ${LEGAL.privacyEmail}.`],
        },
      ]}
    />
  );
}
