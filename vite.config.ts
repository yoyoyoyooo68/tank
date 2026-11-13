import { defineConfig } from 'vite';

// 相対パスで出力するので、GitHub Pages のサブパス（/tank/）でもそのまま動く
export default defineConfig({
  base: './',
});
