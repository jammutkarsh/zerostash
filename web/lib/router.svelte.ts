// ponytail: a few flat routes don't need a router library.
export const route = $state({ path: location.pathname });

export function navigate(path: string) {
	if (path === route.path) return;
	history.pushState(null, '', path);
	route.path = path;
}

addEventListener('popstate', () => (route.path = location.pathname));
