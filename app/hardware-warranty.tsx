import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/** Sensor Warranty & Safety — part of the Terms of Service. */
export default function HardwareWarranty() {
  return (
    <LegalScreen
      title="Sensor Warranty & Safety"
      intro="These terms cover Greenr sensors: how to use them safely, how firmware updates work, and what the limited warranty covers. They form part of our Terms of Service."
      summary={[
        'Only the probe goes in the soil. Keep the electronics dry and on a reliable power supply.',
        'Keep sensors away from small children and pets that might chew them.',
        `Sensors have a ${LEGAL.hardwareWarrantyMonths}-month limited warranty against defects, on top of your legal rights.`,
      ]}
      sections={[
        {
          heading: 'Safety',
          body: [
            '• Insert only the probe into the soil, up to the marked line. Do not submerge the electronics, water directly onto them, or use the sensor in standing water or outdoors in rain unless it is marked as weather-resistant.',
            '• Power the sensor only from a USB power source or battery that meets the included specification. Do not use damaged cables, and unplug the sensor before cleaning it.',
            '• The sensor contains small parts and, in some models, a battery. Keep it away from young children and from pets that might chew it. If a battery is swallowed, get medical help immediately.',
            '• Do not open, modify, puncture or heat the sensor or its battery. Stop using it if it becomes hot, swollen, cracked or smells of burning.',
            '• Recycle sensors and batteries at an electronics recycling point. Do not put them in household waste.',
          ],
        },
        {
          heading: 'Accuracy and reliability',
          body: [
            'Readings are estimates. They depend on probe depth, soil type, calibration, light angle, power and Wi-Fi or Bluetooth signal. A computer USB port that sleeps will interrupt reporting. Use the in-app calibration and placement guidance for the best results, and check the soil yourself before acting on an unusual reading.',
          ],
        },
        {
          heading: 'Connectivity and firmware',
          body: [
            'Sensors connect to your Wi-Fi, or to your phone over Bluetooth, to upload readings to your account. Your Wi-Fi password is sent only to the sensor and stored there. We may release firmware updates to fix problems, improve accuracy or close security issues. You can install them from the app. Some security updates may install automatically. Before giving a sensor away, release it from your account under Devices, so the new owner can pair it and your readings stay private.',
          ],
        },
        {
          heading: 'Limited warranty',
          body: [
            `We warrant that each Greenr sensor will be free from defects in materials and workmanship under normal use for ${LEGAL.hardwareWarrantyMonths} months from the date it was delivered to the original purchaser. If a covered defect appears, contact ${LEGAL.supportEmail} with your proof of purchase. We will repair or replace the sensor, or refund the purchase price if neither is practical.`,
            'This warranty does not cover: normal wear, cosmetic damage, or battery capacity loss over time; damage from water on the electronics, drops, misuse, unsuitable power, or unauthorised modification or firmware; or plant loss or other consequential loss.',
            'This warranty is in addition to, and does not limit, your statutory consumer rights. In many countries, for example the EU and UK, you are entitled to a remedy for goods that are faulty or not as described for at least two years.',
          ],
        },
        {
          heading: 'Returns',
          body: [
            'If you bought a sensor directly from us, you may return it unused, in its original packaging, within 30 days of delivery for a refund, or within any longer period your local law gives you. Sensors bought from a retailer follow that retailer’s return policy.',
          ],
        },
      ]}
    />
  );
}
