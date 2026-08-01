import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Hello My Photos',
				short_name: 'Photos',
				description: 'Your beautiful photo gallery',
				theme_color: '#ffffff',
				icons: [
					{
						src: 'icon.svg',
						sizes: '192x192 512x512',
						type: 'image/svg+xml',
						purpose: 'any maskable'
					}
				]
			}
		})
	],
	server: {
		proxy: {
			'/api': {
				target: process.env.BACKEND_PROXY_URL || 'http://localhost:3000',
				changeOrigin: true
			}
		}
	}
});
