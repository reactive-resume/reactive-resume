import type { ResumeData } from "./data";
import { sectionDefaults } from "./default";

export const sampleResumeData: ResumeData = {
	picture: {
		hidden: false,
		fit: "cover",
		url: "/photos/sample-picture.jpg",
		size: 100,
		rotation: 0,
		aspectRatio: 1,
		borderRadius: 0,
		borderColor: "rgba(0, 0, 0, 0.5)",
		borderWidth: 0,
		shadowColor: "rgba(0, 0, 0, 0.5)",
		shadowWidth: 0,
	},
	basics: {
		name: "David Kowalski",
		headline: "Game Developer | Unity & Unreal Engine Specialist",
		email: "david.kowalski@email.com",
		phone: "+1 (555) 291-4756",
		location: "Seattle, WA",
		website: {
			url: "https://davidkowalski.games",
			label: "davidkowalski.games",
		},
		customFields: [
			{
				id: "019bef5a-0477-77e0-968b-5d0e2ecb34e3",
				icon: "github-logo",
				text: "github.com/dkowalski-dev",
				link: "https://github.com/dkowalski-dev",
			},
			{
				id: "019bef5a-93e4-7746-ad39-3a132360f823",
				icon: "game-controller",
				text: "itch.io/dkowalski",
				link: "https://itch.io/dkowalski",
			},
		],
	},
	summary: {
		...sectionDefaults("article"),
		content:
			"<p><strong>Passionate game developer with 5+ years of professional experience</strong> creating engaging gameplay systems and polished player experiences across multiple platforms. Specialized in Unity and Unreal Engine with strong expertise in C#, C++, and game design principles. Proven ability to collaborate effectively with cross-functional teams including designers, artists, and QA to deliver high-quality games on time and within scope.</p>",
	},
	sections: {
		profiles: {
			...sectionDefaults("messenger-logo"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-3d42ddc9b4d8",
					hidden: false,
					icon: "github-logo",
					iconColor: "",
					network: "GitHub",
					username: "dkowalski-dev",
					website: {
						url: "https://github.com/dkowalski-dev",
						label: "github.com/dkowalski-dev",
						inlineLink: false,
					},
				},
				{
					id: "019bef5a-93e4-7746-ad39-43c470b77f4a",
					hidden: false,
					icon: "linkedin-logo",
					iconColor: "",
					network: "LinkedIn",
					username: "davidkowalski",
					website: {
						url: "https://linkedin.com/in/davidkowalski",
						label: "linkedin.com/in/davidkowalski",
						inlineLink: false,
					},
				},
			],
		},
		experience: {
			...sectionDefaults("briefcase"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-44d8cec98ca4",
					hidden: false,
					company: "Cascade Studios",
					position: "Senior Game Developer",
					location: "Seattle, WA",
					period: "March 2022 - Present",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li><p>Lead gameplay programmer on an unannounced AAA action-adventure title built in Unreal Engine 5 for PC and next-gen consoles</p></li><li><p>Architected and implemented core combat system including hit detection, combo mechanics, and enemy AI behavior trees serving 15+ enemy types</p></li><li><p>Developed custom editor tools in C++ that reduced level designer iteration time by 40% and improved workflow efficiency across the team</p></li><li><p>Optimized rendering pipeline and gameplay systems to maintain 60 FPS performance target on all supported platforms, achieving 95% frame rate stability</p></li><li><p>Collaborated with designers and QA to resolve gameplay defects and ship stable milestone builds.</p></li></ul><p></p>",
				},
			],
		},
		education: {
			...sectionDefaults("graduation-cap"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-48455f6cef9e",
					hidden: false,
					school: "University of Washington",
					degree: "Bachelor of Science",
					area: "Computer Science",
					grade: "3.6 GPA",
					location: "Seattle, WA",
					period: "2014 - 2018",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Concentration in Game Development. Relevant Coursework: Game Engine Architecture, Computer Graphics, Artificial Intelligence, Physics Simulation, 3D Mathematics, Software Engineering, Data Structures & Algorithms</p>",
				},
			],
		},
		projects: {
			...sectionDefaults("code-simple"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-4d2603fe2801",
					hidden: false,
					name: "Echoes of the Void (Indie Game)",
					period: "2023 - Present",
					website: {
						url: "https://itch.io/echoes-of-the-void",
						label: "View on itch.io",
						inlineLink: false,
					},
					description:
						"<p>Solo developer for a narrative-driven 2D platformer built in Unity. Features custom dialogue system, branching story paths, and atmospheric pixel art. Currently in development with demo released on itch.io garnering 5K+ downloads and positive community feedback. Planned Steam release Q2 2025.</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-524195dd7eff",
					hidden: false,
					name: "Open Source: Unity Dialogue Framework",
					period: "2021 - 2023",
					website: {
						url: "https://github.com/dkowalski-dev/unity-dialogue",
						label: "View on GitHub",
						inlineLink: false,
					},
					description:
						"<p>Created and maintain an open-source dialogue system for Unity with visual node-based editor, localization support, and voice acting integration. Project has 800+ GitHub stars and is actively used by indie developers worldwide. Includes comprehensive documentation and example projects.</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-549106273c73",
					hidden: false,
					name: "Game Jam Participation",
					period: "2019 - Present",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Regular participant in Ludum Dare and Global Game Jam events. Created 12+ game prototypes exploring experimental mechanics and art styles. Won 'Best Gameplay' award at Ludum Dare 48 with puzzle game 'Deeper and Deeper' that ranked in top 5% overall.</p>",
				},
			],
		},
		skills: {
			...sectionDefaults("compass-tool"),
			layout: "default",
			keywordLayout: "inline",
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-5a52dcf50ed4",
					hidden: false,
					icon: "code",
					iconColor: "",
					name: "Unity Engine",
					proficiency: "Expert",
					level: 5,
					keywords: ["C#", "Editor Tools", "Performance Profiling"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-5e8bb7cacbc8",
					hidden: false,
					icon: "brackets-curly",
					iconColor: "",
					name: "Unreal Engine",
					proficiency: "Advanced",
					level: 4,
					keywords: ["C++", "Blueprints", "UE5 Features"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-622f9d41da55",
					hidden: false,
					icon: "cpu",
					iconColor: "",
					name: "Programming Languages",
					proficiency: "Expert",
					level: 5,
					keywords: ["C#", "C++", "Python", "HLSL/GLSL"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-6574ab6814bd",
					hidden: false,
					icon: "brain",
					iconColor: "",
					name: "Game AI",
					proficiency: "Advanced",
					level: 4,
					keywords: ["Behavior Trees", "FSM", "Pathfinding", "Navigation"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-6a8e22bec684",
					hidden: false,
					icon: "shooting-star",
					iconColor: "",
					name: "Physics & Mathematics",
					proficiency: "Advanced",
					level: 4,
					keywords: ["3D Math", "Collision Detection", "Rigid Body Dynamics"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-6d8bf7be7514",
					hidden: true,
					icon: "chart-line-up",
					iconColor: "",
					name: "Performance Optimization",
					proficiency: "Advanced",
					level: 4,
					keywords: ["Profiling", "Memory Management", "Frame Rate"],
				},
			],
		},
		languages: {
			...sectionDefaults("translate"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-73807ccc48b5",
					hidden: false,
					language: "English",
					fluency: "Native",
					level: 5,
				},
				{
					id: "019bef5a-93e4-7746-ad39-768670459358",
					hidden: false,
					language: "Polish",
					fluency: "Conversational",
					level: 3,
				},
			],
		},
		interests: {
			...sectionDefaults("football"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-7821b4de95f7",
					hidden: false,
					icon: "game-controller",
					iconColor: "",
					name: "Game Design",
					keywords: ["Mechanics", "Level Design", "Player Psychology"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-7c64c1a607d3",
					hidden: false,
					icon: "robot",
					iconColor: "",
					name: "AI & Procedural Generation",
					keywords: ["PCG", "Machine Learning", "Emergent Gameplay"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-80bccce3c0ef",
					hidden: false,
					icon: "book-open",
					iconColor: "",
					name: "Indie Game Development",
					keywords: ["Solo Dev", "Game Jams", "Community"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-84bb7e9af005",
					hidden: false,
					icon: "pen-nib",
					iconColor: "",
					name: "Technical Art",
					keywords: ["Shaders", "VFX", "Optimization"],
				},
			],
		},
		awards: {
			...sectionDefaults("trophy"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-8a8bb9fbe182",
					hidden: false,
					title: "Best Gameplay - Ludum Dare 48",
					awarder: "Ludum Dare",
					date: "April 2021",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Awarded for puzzle game 'Deeper and Deeper' which ranked in the top 5% overall among 3,000+ submissions</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-8dd81379c7c9",
					hidden: false,
					title: "Employee Excellence Award",
					awarder: "Pixel Forge Interactive",
					date: "December 2021",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Recognized for exceptional contributions to 'Starbound Odyssey' development and dedication to code quality</p>",
				},
			],
		},
		certifications: {
			...sectionDefaults("certificate"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-91fe8a4dfea6",
					hidden: false,
					title: "Unity Certified Expert: Programmer",
					issuer: "Unity Technologies",
					date: "March 2022",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "",
				},
				{
					id: "019bef5a-93e4-7746-ad39-961afccc2508",
					hidden: false,
					title: "Unreal Engine 5 C++ Developer",
					issuer: "Epic Games (Udemy)",
					date: "June 2023",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "",
				},
			],
		},
		publications: {
			...sectionDefaults("books"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-9816f0081895",
					hidden: false,
					title: "Optimizing Unity Games for Mobile: A Practical Guide",
					publisher: "Game Developer Magazine",
					date: "September 2021",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Technical article covering mobile optimization techniques including draw call batching, LOD systems, and memory management</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-9cf55c272c05",
					hidden: false,
					title: "Building Modular Dialogue Systems",
					publisher: "Seattle Indie Game Developers Meetup",
					date: "May 2022",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Presented talk on designing flexible dialogue systems for narrative games, attended by 60+ local developers</p>",
				},
			],
		},
		volunteer: {
			...sectionDefaults("hand-heart"),
			columns: 2,
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-a02580473e05",
					hidden: false,
					organization: "Seattle Indies",
					location: "Seattle, WA",
					period: "2020 - Present",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Active member of local indie game development community. Organize monthly game showcases and provide mentorship to aspiring game developers through code reviews and technical guidance.</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-a731c5b1b286",
					hidden: false,
					organization: "Code.org Game Development Workshops",
					location: "Seattle, WA",
					period: "2021 - Present",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>Volunteer instructor teaching basic game programming concepts to middle school students. Led 8+ workshops introducing Unity fundamentals and game design principles.</p>",
				},
			],
		},
		references: {
			...sectionDefaults("phone"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-a945c0f42dd5",
					hidden: false,
					name: "Available upon request",
					position: "",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					phone: "",
					description: "",
				},
			],
		},
	},
	customSections: [
		{
			...sectionDefaults("briefcase"),
			title: "Earlier experience",
			id: "019becaf-0b87-769d-98a6-46ccf558c0e8",
			type: "experience",
			items: [
				{
					id: "019bef5a-d1fa-7289-a87c-2677688d9e75",
					hidden: false,
					company: "Pixel Forge Interactive",
					position: "Game Developer",
					location: "Bellevue, WA",
					period: "June 2020 - February 2022",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li>Core developer on 'Starbound Odyssey,' a sci-fi roguelike that achieved 500K+ sales on Steam with 'Very Positive' user reviews</li><li>Implemented procedural generation systems for level layouts, enemy encounters, and loot drops using Unity and C#</li><li>Designed and programmed player progression systems including skill trees, equipment upgrades, and meta-progression mechanics</li><li>Created robust save/load system supporting cloud saves and cross-platform play between PC and Nintendo Switch</li><li>Integrated third-party SDKs for analytics (GameAnalytics), achievements (Steamworks), and multiplayer networking (Photon)</li><li>Fixed critical bugs and balanced gameplay based on community feedback and telemetry data, releasing 12 post-launch content updates</li><li>Worked closely with artists to implement VFX, animations, and shaders that enhanced visual polish while maintaining performance targets</li></ul>",
				},
				{
					id: "019bef5a-db0e-73c6-9b6e-4471703864f1",
					hidden: false,
					company: "Mobile Games Studio",
					position: "Junior Game Developer",
					location: "Remote",
					period: "September 2018 - May 2020",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li><p>Contributed to development of three mobile puzzle games built in Unity, collectively downloaded 2M+ times on iOS and Android</p></li><li><p>Implemented UI systems, touch controls, and gesture recognition optimized for mobile devices and various screen sizes</p></li><li><p>Developed monetization features including rewarded video ads, in-app purchases, and daily reward systems that increased retention by 25%</p></li><li><p>Optimized memory usage and load times for mobile platforms, reducing app size by 35% through asset compression and code optimization</p></li><li><p>Collaborated with game designers to balance puzzle difficulty curves and progression pacing using A/B testing data</p></li></ul><p></p>",
				},
			],
		},
	],
	metadata: {
		template: "azurill",
		layout: {
			sidebarWidth: 30,
			pages: [
				{
					fullWidth: false,
					main: ["summary", "education", "experience"],
					sidebar: ["profiles", "skills"],
				},
				{
					fullWidth: false,
					main: ["019becaf-0b87-769d-98a6-46ccf558c0e8", "awards"],
					sidebar: ["certifications", "languages", "interests", "references"],
				},
				{
					fullWidth: true,
					main: ["projects", "publications", "volunteer"],
					sidebar: [],
				},
			],
		},
		page: {
			gapX: 12,
			gapY: 8,
			marginX: 16,
			marginY: 16,
			format: "a4",
			locale: "en-US",
			hideLinkUnderline: false,
			hideIcons: false,
			hideSectionIcons: false,
		},
		design: {
			level: {
				icon: "star",
				type: "icon",
			},
			colors: {
				primary: "rgba(0, 112, 178, 1)",
				text: "rgba(0, 0, 0, 1)",
				background: "rgba(255, 255, 255, 1)",
			},
		},
		typography: {
			body: {
				fontFamily: "IBM Plex Serif",
				fontWeights: ["400", "600"],
				fontSize: 10,
				lineHeight: 1.5,
			},
			heading: {
				fontFamily: "Fira Sans Condensed",
				fontWeights: ["500"],
				fontSize: 12,
				lineHeight: 1.5,
			},
		},
		notes: "",
		styleRules: [],
	},
};

/**
 * Returns the sample resume, optionally overriding `basics.name` so the seeded
 * content reflects the name the user entered when creating the resume. When no
 * name is given, the default sample persona is returned unchanged.
 */
export const createSampleResumeData = (name?: string): ResumeData => {
	const trimmed = name?.trim();
	if (!trimmed) return sampleResumeData;

	return { ...sampleResumeData, basics: { ...sampleResumeData.basics, name: trimmed } };
};
