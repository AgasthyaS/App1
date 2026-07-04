import * as ImagePicker from 'expo-image-picker';

/**
 * Pick a plant photo. Returns a data URI (base64) so it persists across
 * reloads on every platform, or null if the user cancelled. A square,
 * compressed crop keeps stored size small.
 */

function toDataUri(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.base64) {
    const mime = asset.mimeType ?? 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  }
  // web returns a usable uri (blob/data) directly
  return asset.uri ?? null;
}

const OPTS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.5,
  base64: true,
};

export async function takePlantPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync(OPTS);
  if (res.canceled || !res.assets?.[0]) return null;
  return toDataUri(res.assets[0]);
}

export async function pickPlantPhoto(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync(OPTS);
  if (res.canceled || !res.assets?.[0]) return null;
  return toDataUri(res.assets[0]);
}
