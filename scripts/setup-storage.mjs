import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kavfjyvsvgvcjiuwwfbw.supabase.co';
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(url, secretKey);

async function setupStorage() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const hasAvatars = buckets?.some(b => b.name === 'avatars');
  if (!hasAvatars) {
    console.log('Creating public avatars bucket...');
    const { data, error } = await supabase.storage.createBucket('avatars', {
      public: true,
      fileSizeLimit: 1048576, // 1MB
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
    });
    console.log('Bucket created:', { data, error });
  } else {
    console.log('Avatars bucket already exists.');
  }
}

setupStorage().catch(console.error);
