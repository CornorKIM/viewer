import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // localtunnel(예: https://xxxx.loca.lt)로 외부에 공유할 때
    // Vite가 낯선 Host 헤더를 막는 보안 기능(DNS 리바인딩 방지) 때문에
    // "Blocked request" 에러가 나는 걸 풀어줍니다.
    // '.loca.lt'로 끝나는 모든 주소를 허용하므로, localtunnel을 다시 켜서
    // 주소가 바뀌어도(예: calm-cobras-sin.loca.lt → 다른 이름) 이 설정을
    // 다시 고칠 필요가 없습니다.
    // '.trycloudflare.com' = share.bat(Cloudflare 임시 터널)로 공유할 때의 주소.
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
  },
});
