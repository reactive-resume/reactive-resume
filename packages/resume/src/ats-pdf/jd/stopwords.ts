/**
 * Words that carry no signal in a keyword-coverage comparison.
 *
 * Two groups: ordinary English function words, and the boilerplate every posting shares —
 * "equal opportunity employer", "competitive salary", "fast-paced environment". A resume gains
 * nothing by matching the parts of a posting that are identical across every posting.
 */
const FUNCTION_WORDS =
	"a about above across after again against all almost along already also although always am among an and another " +
	"any anyone anything are around as at back be became because become been before began begin behind being below " +
	"beside besides best better between both but by came can cannot come could did do does doing done down during " +
	"each either else enough etc even ever every everything few for from further get give go going good got had half " +
	"has have having he her here hers herself him himself his how however i if in inside instead into is it its " +
	"itself just keep kind know large last later least left less let like likely little long made make many may me " +
	"might mine more most much must my myself near need never new next no nor not now of off often on once one only " +
	"onto or other others our ours out outside over own per perhaps please plus rather really right same say see " +
	"seem set several shall she should since so some something soon still such than that the their theirs them " +
	"themselves then there these they thing think this those though three through throughout thus to together too " +
	"toward towards two under until up upon us use used using very via was way we well went were what when where " +
	"whether which while who whom whose why will with within without would yet you your yours yourself";

const RECRUITING_BOILERPLATE =
	"bonus deep demonstrated detail driven eager excellent exceptional familiar familiarity great hands hands-on " +
	"knowledge expert expertise experienced fluent comfortable strong-plus " +
	"ideally including keen looking love nice offering outstanding package passion plus preferably proven required " +
	"solid strong track understanding well willing " +
	"ability applicant applicants apply application balance benefits candidate candidates career color colour " +
	"company compensation competitive culture disability diverse diversity dynamic employee employer employment " +
	"environment equal ethnicity excellent experience fast fast-paced gender growth identity inclusion inclusive " +
	"individual job join life location marital minimum must national opportunity opportunities orientation " +
	"package paced paid parental passionate pay people plus preferred qualification qualifications qualified race " +
	"regard religion remote required requirement requirements responsibilities responsibility role roles salary " +
	"seeking sex sexual skills status team teams thrive time title veteran welcome work working workplace years";

/** Counted words: "five teams" names a size, not a skill. */
const NUMBER_WORDS =
	"zero four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty hundred thousand " +
	"million billion dozen dozens multi multiple";

/**
 * Words that describe the work or the job rather than name a skill. A senior reader is told to add "drive",
 * "grow" or "background" to a resume and stops trusting the list.
 *
 * Verbs and qualifiers carry nothing on their own or at the head of a phrase: "drive hiring", "senior engineers",
 * "improve deployment". Nouns carry nothing on their own but do name a skill with the word before them or after
 * them: "big data", "hybrid cloud", "partner management", "technical lead", "engineering managers".
 */
const LEADING_GENERIC_WORDS =
	"drive driving grow growing partnering lead leading own owning building help helping improve " +
	"improving deliver delivering create creating define defining ensure ensuring shape " +
	"shaping scale scaling run running bring bringing take taking coach collaborate collaborating managing " +
	"various several varied nice-to-have must-have bonus-points " +
	"multi-year year-round day-to-day day days week weeks month months year yearly annual annually quarterly " +
	"daily weekly onsite on-site full-time part-time senior junior " +
	"mid-level large small modern complex world-class impactful successful " +
	"great top early current future overall ideal ideally thing things stuff ways asap values-driven " +
	"evolve evolving analyze analyzing analyse analysing hire hiring support supporting values aa aaa";

const SOLO_GENERIC_WORDS =
	"partner build head chief ceo cto cfo coo founder founders director directors manager managers " +
	"changes background backgrounds hybrid big global impact frameworks domain domains area areas space spaces " +
	"part parts level levels mission missions vision values record group groups report staff product products";

/** Never part of a term, wherever they appear. */
export const JD_STOPWORDS: ReadonlySet<string> = new Set(
	[...FUNCTION_WORDS.split(" "), ...RECRUITING_BOILERPLATE.split(" "), ...NUMBER_WORDS.split(" ")].filter(Boolean),
);

/** Never a term on their own, nor the first word of one. */
export const JD_LEADING_GENERIC_WORDS: ReadonlySet<string> = new Set(LEADING_GENERIC_WORDS.split(" "));

/** Never a term on their own; fine inside a longer one. */
export const JD_SOLO_GENERIC_WORDS: ReadonlySet<string> = new Set(SOLO_GENERIC_WORDS.split(" "));
