// 每天一个小故事 · Service Worker
// 这是一个"孩子用的离线 App"：连发音音频一起缓存，断网也能听。
//
// 缓存分两块，互不干扰：
//   1) 应用外壳（HTML / 清单 / 图标）
//   2) 发音音频（audio/*.mp3，清单见 audio/manifest.json，由 gen_audio.py 生成）
// 只改了音频、没改代码时，把 AUDIO_CACHE 版本号 +1 即可，不用动外壳缓存。

const SHELL_CACHE = 'dsh-story-shell-v4';   // v4：加入「跟我读」录音功能
const AUDIO_CACHE = 'dsh-story-audio-v2';   // v2：加入 30 个 0.7X 慢速单词音频
const AUDIO_MANIFEST = './audio/manifest.json';

const SHELL_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// 安装：先把外壳和音频清单缓存好
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (c) { return c.addAll(SHELL_ASSETS); })
      .then(function () { return preloadAudio(); })
      .then(function () { return self.skipWaiting(); })
  );
});

// 把 audio/manifest.json 里列出的音频全部拉进缓存（失败也不影响安装）
function preloadAudio() {
  return fetch(AUDIO_MANIFEST, { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      var list = (data.words || [])
        .concat(data.wordsSlow || [])          // 0.7X 慢速单词也要离线可用
        .concat(data.sentences || []);
      return caches.open(AUDIO_CACHE).then(function (c) {
        return Promise.all(list.map(function (name) {
          var url = './audio/' + name;
          return c.match(url).then(function (hit) {
            return hit ? null : c.add(url).catch(function () { return null; });
          });
        }));
      });
    })
    .catch(function () { return null; });
}

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== SHELL_CACHE && k !== AUDIO_CACHE;
      }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 缓存优先：孩子点开就有，不等待网络；同时后台更新，下次生效。
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var isAudio = /\/audio\/[^/]+\.mp3$/.test(url.pathname);

  e.respondWith(
    caches.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(isAudio ? AUDIO_CACHE : SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return hit || (isAudio ? undefined : caches.match('./index.html'));
      });
      return hit || net;
    })
  );
});
