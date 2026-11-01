/**
 * Surface form -> canonical form.
 *
 * A posting says "K8s", a resume says "Kubernetes", and a keyword comparison that misses that is
 * worse than useless — it tells the candidate to add something they already have. The list is
 * deliberately curated rather than derived: every entry is a pair a recruiter would treat as the
 * same thing, and nothing here guesses.
 */
const ALIASES: Readonly<Record<string, string>> = {
	// Languages and runtimes
	js: "javascript",
	ecmascript: "javascript",
	ts: "typescript",
	"node.js": "node",
	nodejs: "node",
	"c++": "cpp",
	cplusplus: "cpp",
	"c#": "csharp",
	".net": "dotnet",
	"asp.net": "aspnet",
	py: "python",
	python3: "python",
	golang: "go",
	rustlang: "rust",
	objc: "objective-c",
	"objective c": "objective-c",
	php7: "php",
	php8: "php",
	rb: "ruby",
	"ruby on rails": "rails",
	ror: "rails",

	// Front end
	reactjs: "react",
	"react.js": "react",
	"react native": "react-native",
	reactnative: "react-native",
	vuejs: "vue",
	"vue.js": "vue",
	angularjs: "angular",
	nextjs: "next",
	"next.js": "next",
	nuxtjs: "nuxt",
	sveltekit: "svelte",
	css3: "css",
	html5: "html",
	scss: "sass",
	tailwindcss: "tailwind",
	"styled components": "styled-components",
	"material ui": "mui",
	"react testing library": "testing-library",

	// Back end and data
	postgres: "postgresql",
	psql: "postgresql",
	"my sql": "mysql",
	mssql: "sql-server",
	"sql server": "sql-server",
	"ms sql": "sql-server",
	mongo: "mongodb",
	"elastic search": "elasticsearch",
	dynamo: "dynamodb",
	"big query": "bigquery",
	"apache kafka": "kafka",
	"apache spark": "spark",
	"apache airflow": "airflow",
	rabbit: "rabbitmq",
	"rest api": "rest",
	restful: "rest",
	"restful api": "rest",

	// Cloud and platform
	"amazon web services": "aws",
	gcp: "google-cloud",
	"google cloud": "google-cloud",
	"google cloud platform": "google-cloud",
	"microsoft azure": "azure",
	k8s: "kubernetes",
	kube: "kubernetes",
	eks: "kubernetes",
	gke: "kubernetes",
	aks: "kubernetes",
	containerization: "containers",
	containerisation: "containers",
	iac: "infrastructure-as-code",
	"infrastructure as code": "infrastructure-as-code",
	tf: "terraform",
	"ci/cd": "ci-cd",
	cicd: "ci-cd",
	"continuous integration": "ci-cd",
	"continuous delivery": "ci-cd",
	"continuous deployment": "ci-cd",
	"github actions": "github-actions",
	gha: "github-actions",
	"gitlab ci": "gitlab-ci",
	lambda: "aws-lambda",
	"aws lambda": "aws-lambda",
	s3: "aws-s3",
	ec2: "aws-ec2",

	// Practice
	"machine learning": "machine-learning",
	ml: "machine-learning",
	"deep learning": "deep-learning",
	ai: "artificial-intelligence",
	"artificial intelligence": "artificial-intelligence",
	nlp: "natural-language-processing",
	"natural language processing": "natural-language-processing",
	llm: "large-language-models",
	llms: "large-language-models",
	"large language model": "large-language-models",
	"large language models": "large-language-models",
	genai: "generative-ai",
	"gen ai": "generative-ai",
	"generative ai": "generative-ai",
	"computer vision": "computer-vision",
	elt: "etl",
	"data pipeline": "data-pipelines",
	"data pipelines": "data-pipelines",
	"data warehouse": "data-warehousing",
	"data warehousing": "data-warehousing",
	tdd: "test-driven-development",
	"test driven development": "test-driven-development",
	bdd: "behaviour-driven-development",
	ddd: "domain-driven-design",
	"domain driven design": "domain-driven-design",
	oop: "object-oriented-programming",
	"object oriented": "object-oriented-programming",
	soa: "service-oriented-architecture",
	"micro services": "microservices",
	"micro-services": "microservices",
	"event driven": "event-driven",
	"event-driven": "event-driven",

	// Ways of working
	"agile methodology": "agile",
	"agile methodologies": "agile",
	safe: "scaled-agile",
	"scaled agile": "scaled-agile",
	"a/b testing": "ab-testing",
	"ab testing": "ab-testing",
	"user research": "user-research",
	ux: "user-experience",
	"user experience": "user-experience",
	ui: "user-interface",
	"user interface": "user-interface",
	"product management": "product-management",
	"project management": "project-management",
	pmp: "project-management",
	okr: "okrs",
	kpi: "kpis",

	// Security and compliance
	infosec: "information-security",
	"information security": "information-security",
	appsec: "application-security",
	"application security": "application-security",
	soc2: "soc-2",
	"soc 2": "soc-2",
	pci: "pci-dss",
	"pci dss": "pci-dss",
	iso27001: "iso-27001",
	"iso 27001": "iso-27001",
	sso: "single-sign-on",
	"single sign on": "single-sign-on",
	oauth2: "oauth",
	"oauth 2.0": "oauth",
	mfa: "multi-factor-authentication",
	"2fa": "multi-factor-authentication",
	"two factor": "multi-factor-authentication",
	pentest: "penetration-testing",
	"penetration testing": "penetration-testing",

	// Business and finance
	crm: "crm",
	"p&l": "profit-and-loss",
	"profit and loss": "profit-and-loss",
	"fp&a": "financial-planning-and-analysis",
	fpa: "financial-planning-and-analysis",
	roi: "return-on-investment",
	"go to market": "go-to-market",
	gtm: "go-to-market",
	cro: "conversion-rate-optimization",
	"lead generation": "lead-generation",
	"lead gen": "lead-generation",

	// Tools
	vscode: "vs-code",
	"vs code": "vs-code",
	"visual studio code": "vs-code",
	powerbi: "power-bi",
	"power bi": "power-bi",
	"microsoft excel": "excel",
	"google analytics": "google-analytics",
	ga4: "google-analytics",
	unix: "linux",
	shell: "bash",
};

/** Canonical form -> every surface form that maps onto it, so a resume matching any of them counts. */
const SURFACES_BY_CANONICAL = (() => {
	const map = new Map<string, Set<string>>();

	for (const [surface, canonical] of Object.entries(ALIASES)) {
		const surfaces = map.get(canonical) ?? new Set<string>([canonical]);
		surfaces.add(surface);
		map.set(canonical, surfaces);
	}

	return map;
})();

/**
 * Terms whose surface form *is* the thing being searched for, and which must therefore never be
 * stemmed. "kubernetes" stems to "kubernet", which matches nothing a recruiter would ever type.
 */
export const SKILL_SURFACE_FORMS: ReadonlySet<string> = new Set([
	...Object.keys(ALIASES),
	...SURFACES_BY_CANONICAL.keys(),
]);

export function canonicalize(term: string): string {
	return ALIASES[term] ?? term;
}

/** Every spelling that should count as a match for `term`, including `term` itself. */
export function surfaceFormsOf(term: string): readonly string[] {
	const canonical = canonicalize(term);
	const surfaces = SURFACES_BY_CANONICAL.get(canonical);
	return surfaces ? [...surfaces] : [term];
}
