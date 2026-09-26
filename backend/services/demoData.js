const demoVideos = [
  {
    id: 'demo-video-1',
    title: 'Mia Colby — Premium Preview',
    bunny_video_id: 'demo-1',
    thumbnail_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80',
    preview_animation_url: '',
    duration_seconds: 142,
    price_euros: 9.99,
    paywall_delay_seconds: 15,
    views_count: 245000,
    likes_count: 1200,
    dislikes_count: 48,
    orientation: 'straight',
    category_name: 'Verified Models',
    category_slug: 'verified-models',
    performers: [{ id: 'demo-performer-1', name: 'Mia Colby', slug: 'mia-colby' }],
    tags: ['4k', 'premium', 'teaser'],
    is_vr: false,
    is_amateur: false,
    is_published: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-video-2',
    title: 'Behind the Scenes',
    bunny_video_id: 'demo-2',
    thumbnail_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
    preview_animation_url: '',
    duration_seconds: 210,
    price_euros: 12.99,
    paywall_delay_seconds: 20,
    views_count: 198000,
    likes_count: 980,
    dislikes_count: 36,
    orientation: 'straight',
    category_name: 'Amateur',
    category_slug: 'amateur',
    performers: [{ id: 'demo-performer-2', name: 'Mia Colby', slug: 'mia-colby' }],
    tags: ['behind-the-scenes', 'cast'],
    is_vr: false,
    is_amateur: true,
    is_published: true,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'demo-video-3',
    title: 'Late Night Session',
    bunny_video_id: 'demo-3',
    thumbnail_url: 'https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=900&q=80',
    preview_animation_url: '',
    duration_seconds: 324,
    price_euros: 14.99,
    paywall_delay_seconds: 25,
    views_count: 312000,
    likes_count: 1800,
    dislikes_count: 52,
    orientation: 'straight',
    category_name: 'Solo & Couples',
    category_slug: 'solo-couples',
    performers: [{ id: 'demo-performer-3', name: 'Mia Colby', slug: 'mia-colby' }],
    tags: ['night', 'solo'],
    is_vr: false,
    is_amateur: false,
    is_published: true,
    created_at: new Date(Date.now() - 7200000).toISOString(),
  },
];

function getDemoVideos() {
  return demoVideos.map((video) => ({ ...video }));
}

function getDemoVideoById(id) {
  return demoVideos.find((video) => video.id === id) || null;
}

function getDemoStreamUrl() {
  return 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
}

function getDemoThumbnailUrl() {
  return 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80';
}

module.exports = {
  getDemoVideos,
  getDemoVideoById,
  getDemoStreamUrl,
  getDemoThumbnailUrl,
};
