import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Card, GButton, Hairline, Screen, SectionHeader } from '@/components/greenr/UI';
import { accent, dark, type } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';


interface Member { member_email: string; role: string; member_id: string | null }

export default function Household() {
  const router = useRouter();
  const { user, enabled } = useAuth();
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('garden_shares').select('member_email,role,member_id').eq('owner_id', user.id);
    setMembers((data as Member[]) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) { setNote('Enter a valid email.'); return; }
    if (!supabase) { setNote('Sharing needs an account — sign in first.'); return; }
    setBusy(true); setNote(null);
    try {
      const { data, error } = await supabase.rpc('invite_member', { p_email: e, p_role: 'viewer' });
      if (error) throw error;
      setEmail('');
      setNote((data as any)?.member_exists ? 'Invited — they can view your garden now when they sign in.' : 'Invited — they’ll get access once they create a Greenr account with this email.');
      load();
    } catch (err: any) {
      setNote(err?.message ?? 'Could not send the invite. Did you run the sharing SQL in Supabase?');
    } finally { setBusy(false); }
  };

  const remove = async (m: Member) => {
    if (!supabase || !user) return;
    await supabase.from('garden_shares').delete().eq('owner_id', user.id).eq('member_email', m.member_email);
    load();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={dark.ink} />
        </Pressable>
        <Text style={[type.screenTitle, { color: dark.ink, fontSize: 24 }]}>Household</Text>
      </View>

      <Card style={{ marginTop: 12 }}>
        <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>
          Share your garden with family or a housemate so everyone can see how the plants are doing.
          Invite them by the email they use (or will use) for Greenr.
        </Text>
      </Card>

      {!enabled || !user ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={[type.body, { color: dark.inkMuted, lineHeight: 21 }]}>Sign in to your account to share your garden.</Text>
        </Card>
      ) : (
        <>
          <SectionHeader>Invite someone</SectionHeader>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
                placeholder="their@email.com" placeholderTextColor={dark.inkMuted}
                style={{ flex: 1, color: dark.ink, backgroundColor: dark.surface2, borderRadius: 10, paddingHorizontal: 12, minHeight: 46, fontSize: 15 }}
              />
              <GButton title={busy ? '…' : 'Invite'} onPress={invite} disabled={busy} style={{ paddingHorizontal: 18, minHeight: 46 }} />
            </View>
            {note && <Text style={[type.caption, { color: accent.sage, marginTop: 8, lineHeight: 18 }]}>{note}</Text>}
          </Card>

          <SectionHeader>Members</SectionHeader>
          <Card>
            {members.length === 0 && <Text style={[type.caption, { color: dark.inkMuted }]}>No one yet — invite someone above.</Text>}
            {members.map((m, i) => (
              <View key={m.member_email}>
                {i > 0 && <Hairline />}
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 10 }}>
                  <Ionicons name="person-circle-outline" size={22} color={dark.inkMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: dark.ink }]} numberOfLines={1}>{m.member_email}</Text>
                    <Text style={[type.micro, { color: m.member_id ? accent.sage : dark.inkMuted }]}>
                      {m.member_id ? 'Active' : 'Invited — pending sign-up'}
                    </Text>
                  </View>
                  <Pressable onPress={() => remove(m)} hitSlop={8}><Ionicons name="close" size={18} color={dark.inkMuted} /></Pressable>
                </View>
              </View>
            ))}
          </Card>

          <Text style={[type.micro, { color: dark.inkMuted, marginTop: 12, lineHeight: 15 }]}>
            Members get read access to your sensors&apos; data. A dedicated “switch to their garden” view is
            rolling out next — for now, sharing covers live sensor readings.
          </Text>
        </>
      )}
    </Screen>
  );
}
