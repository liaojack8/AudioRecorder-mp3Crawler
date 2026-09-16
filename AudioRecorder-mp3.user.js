// ==UserScript==
// @name         電話錄音系統 MP3 下載
// @namespace    RecordGetter
// @version      1.0.1
// @description  將錄音列表的下載按鈕改為透過系統 MP3 解碼接口下載。
// @match        http://192.168.0.6/*
// @match        https://192.168.0.6/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const selector = 'a.down_trigger';
    const pending = new WeakSet();

    function authorization() {
        const entry = document.cookie.split(';').map(value => value.trim())
            .find(value => value.startsWith('Authorization='));
        if (!entry || !entry.slice(14)) {
            throw new Error('讀不到 Authorization Cookie，請先登入錄音系統後重試。若已登入，請確認此 Cookie 是否限制為 HttpOnly。');
        }
        const value = entry.slice(14);
        try { return decodeURIComponent(value); } catch { return value; }
    }

    function recordingFile(html) {
        const page = new DOMParser().parseFromString(html, 'text/html');
        if (page.querySelector('input[type="password"]')) {
            throw new Error('播放頁回傳登入表單，請重新登入錄音系統後重試。');
        }
        for (const anchor of page.querySelectorAll('a')) {
            // Python 從播放頁的連結文字取得檔名；也支援 URL 中的檔名。
            const candidates = [anchor.textContent.trim()];
            try {
                const url = new URL(anchor.getAttribute('href') || '', location.origin);
                if (url.origin === location.origin) {
                    candidates.push(decodeURIComponent(url.pathname.split('/').pop()));
                }
            } catch { /* 略過無法解析的連結 */ }
            for (const candidate of candidates) {
                // 實機使用 OUT- / IN-；同時相容底線分隔的檔名。
                const match = /^(?:OUT|IN)[_-](\d{4})(\d{2})(\d{2})[^/\\\r\n]*\.wav$/i.exec(candidate);
                if (match) {
                    return {
                        name: candidate.replace(/\.wav$/i, '.mp3'),
                        path: `/record/${match[1]}/${match[2]}/${match[3]}/${candidate}`,
                    };
                }
            }
        }
        throw new Error('播放頁中找不到 IN- / OUT- 或 IN_ / OUT_ 開頭的 WAV 檔名。請確認該筆錄音的播放頁是否有 WAV 下載連結。');
    }

    async function request(url, method, timeout, read) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                method, credentials: 'same-origin', cache: 'no-store',
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`伺服器回應 HTTP ${response.status}，請確認登入狀態與錄音存取權限。`);
            return await read(response);
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('請求逾時，請稍後重試。');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async function download(anchor) {
        if (pending.has(anchor)) return;
        pending.add(anchor);
        anchor.setAttribute('aria-busy', 'true');
        anchor.title = '正在準備 MP3…';
        try {
            const source = new URL(anchor.getAttribute('href'), location.origin);
            const match = /^\/service\/record\/file\/(\d+)\/?$/.exec(source.pathname);
            if (source.origin !== location.origin || !match) {
                throw new Error('無法從下載按鈕辨識錄音序號。');
            }
            // 與 RecordGetter.py 相同，使用 POST 取得播放頁。
            const html = await request(`/playback.lgi?id=${match[1]}`, 'POST', 30000,
                response => response.text());
            const file = recordingFile(html);
            const url = new URL(`/service/decode/mp3/${encodeURIComponent(file.name)}`, location.origin);
            url.searchParams.set('__a', authorization());
            url.searchParams.set('q', file.path);
            anchor.title = '正在下載 MP3…';
            const blob = await request(url, 'GET', 300000, async response => {
                const type = (response.headers.get('content-type') || '').toLowerCase();
                if (/text\/|json|xml/.test(type)) {
                    throw new Error('MP3 接口回傳文字或登入頁面，請重新登入後重試。');
                }
                const data = await response.blob();
                if (!data.size) throw new Error('MP3 接口回傳空白檔案。');
                // 有些設備以 application/octet-stream 回傳錯誤頁。
                const prefix = (await data.slice(0, 256).text()).trimStart();
                if (/^(?:<!doctype\s+html|<html|<head|<body|<\?xml|\{\s*")/i.test(prefix)) {
                    throw new Error('MP3 接口回傳錯誤頁面，請重新登入後重試。');
                }
                return data;
            });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = file.name;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } catch (error) {
            alert(`MP3 下載失敗：${error.message}`);
        } finally {
            pending.delete(anchor);
            anchor.removeAttribute('aria-busy');
            anchor.title = '下載 MP3';
        }
    }

    // 捕獲階段攔截，避免原網站事件啟動 WAV 下載；動態翻頁仍然適用。
    window.addEventListener('click', event => {
        const anchor = event.target instanceof Element ? event.target.closest(selector) : null;
        if (!anchor) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void download(anchor);
    }, true);

    function labelButtons() {
        const heading = document.querySelector('#ps_record thead th.coldown');
        if (heading && heading.textContent !== '下載 MP3') heading.textContent = '下載 MP3';
        document.querySelectorAll(selector).forEach(anchor => {
            if (!pending.has(anchor)) anchor.title = '下載 MP3';
            anchor.setAttribute('aria-label', '下載 MP3');
        });
    }

    function start() {
        labelButtons();
        new MutationObserver(labelButtons).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
