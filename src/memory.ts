import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractObservation, formatObservation, parseObservations, type Observation } from "./observations";
import type { OpencodeClient } from "@opencode-ai/sdk";

type FrontMatter = {
	id: string,
	title: string,
	summary: string,
	updated: string,
	observationCount: string,
};

export const MemoryPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {

	client.app.log({ body: {service: "@virail/memory-plugin", level: "info", message: "[memory plugin] loaded" }});

	const ROOT = join(homedir(), ".config", "opencode", "memory");
	const CONSOLIDATION_THRESHOLD = 200;

    const HELPER_SESSIONS = new Set<string>();

	function topicPath(sessionID: string, topic: string): string {
		return join(ROOT, sessionID, "topics", topic + ".md");
	}

	function topicDir(sessionID: string): string {
		return join(ROOT, sessionID, "topics");
	}

	function observationPath(sessionID: string): string {
		return join(ROOT, sessionID, "observations.md");
	}

	function journeyPath(sessionID: string): string {
		return join(ROOT, sessionID, "journey.md");
	}

	function indexPath(sessionID: string): string {
		return join(ROOT, sessionID, "index.md");
	}

	function createFileIfNotExists(path: string): void {
		const buffer = readFromFile(path);
		if (!buffer) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, "");
		}
	}

	function appendToFile(path: string, sessionID: string, content: string, client: OpencodeClient): void {
		createFileIfNotExists(path);
		appendFileSync(path, content);
		// if file is too big, we move it to an archive file and create a new empty file
		if (shouldConsolidate(sessionID)) {
            const raw = readFromFile(observationPath(sessionID)) ?? "";
            clearBuffer(sessionID);
			void consolidate(sessionID, raw, client).catch((e) => {
                client.tui.showToast({ body: { title: "@virail/obs-memory", message: String(e), variant: "error" }})
            });
		}
	}
	
	function readFromFile(path: string): string | null {
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return null;
		}
	}

	function shouldConsolidate(sessionID: string): Boolean {
		const path = observationPath(sessionID);
		const content = readFromFile(path);
		if (content === null) return false;
		return content.length > CONSOLIDATION_THRESHOLD;
	}
	
	async function consolidate(sessionID: string, raw: string, client: OpencodeClient): Promise<void> {
		// 1. read and pare observations
		const observations = parseObservations(raw);

		// 2. group by filepath
		const grouped = groupObservationsByFilepath(observations);

		// 3. write topic files
		for (const [topicKey, groupedObs] of Object.entries(grouped)) {
            const summary = await deriveSummary(groupedObs);
			writeTopicFiles(sessionID, topicKey, groupedObs, summary);
		}
		
		// 4. update journey log
		updateJourney(sessionID, observations);

		// 5. regenerate index
		regenerateIndex(sessionID);

		// 6. clear buffer
		// clearBuffer(sessionID);

		// Toast on consolidation
		client.tui.showToast({ body: { message: "Consolidating memory", variant: "info" }});
	}

	function updateJourney(sessionID: string, observations: Observation[]): void {
		if (!observations.length) return;
		const path = journeyPath(sessionID);

		// tally counts by tag
		// we would need something like Record<string, number>
		// so we get: file-read: 10, command: 100...
		const countsString = countByTag(observations);

		// gathering areas
		const areas = gatherAreas(observations);

		// notable content
		const notableContent = pickNotableContent(observations);

		const segment = `### ${new Date().toISOString()}\n
**Activity:** ${countsString}\n
**Areas:** ${areas}\n
${notableContent.map(s => `- ${s}`).join("\n")}\n\n`;

		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, segment);

	}

	function pickNotableContent(observations: Observation[], k: number = 4): string[] {
		const candidates = observations
			.filter(o => o.type === "tool" && o.content.trim().length > 20)
			.sort((a, b) => b.content.length - a.content.length);

		const top = candidates.slice(0, k)

		const source = top.length ? top : observations;

		return source.slice(0, k).map(o => `[${o.tag}] ${o.content}`);
	}

	function gatherAreas(observations: Observation[]): string {
		const counts: Record<string, number> = {};

		for (const o of observations) {
			const filePath = o.metadata?.filePath;
			const key = filePath ? deriveTopicKey(filePath) : "other";
			counts[key] = (counts[key] ?? 0) + 1;
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([topic, _]) => `${topic}`)
			.join(", ");
	}

	function countByTag(observations: Observation[]): string {
		const counts: Record<string, number> = {};

		for (const o of observations) counts[o.tag] = (counts[o.tag] ?? 0) + 1;

		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([tag, n]) => `${tag} x${n}`)
			.join(", ");
	}

	function regenerateIndex(sessionID: string): void {
		const entries: FrontMatter[] = [];
		const path = indexPath(sessionID);

		const glob = readdirSync(topicDir(sessionID)).filter(a => a.endsWith(".md"));

		for (const file of glob) {
			const filePath = join(topicDir(sessionID), file);
			const raw = readFileSync(filePath, "utf-8");
			const [frontMatter, _] = parseTopicFile(raw);

			entries.push(frontMatter);
		}

		const sorted = entries.sort((a, b) => b.updated.localeCompare(a.updated));

		const indexContent = formatIndex(sorted);
		
		mkdirSync(dirname(path), { recursive: true });
		
		atomicWrite(indexPath(sessionID), indexContent);
	}

	function formatIndex(topics: FrontMatter[]): string {
		const header = `| Topic | Summary | Updated |
|---|---|---|\n`;
		var content = "";
		for (const topic of topics) {
			content += `| ${topic.title} | ${topic.summary} | ${topic.updated}\n`;
		}
		return header + content;
	}

	function clearBuffer(sessionID: string): void {
		writeFileSync(observationPath(sessionID), "");
	}

	function renderFrontMatter(fm: FrontMatter): string {
		return `---
id: ${fm.id}
title: ${fm.title}
summary: ${fm.summary}
updated: ${fm.updated}
observation_count: ${fm.observationCount}
---`
	}

	function parseFrontMatter(raw: string): FrontMatter {
		const lines = raw.split("\n");
		var frontMatter: FrontMatter = { id: "", title: "", summary: "", updated: "", observationCount: ""};

		for (const line of lines) {
			const match = line.match(/^(.*):\s*(.*)$/);

			if (!match) continue

			const key = match[1].trim();
			const value = match[2].trim();

			if (key in frontMatter) {
				frontMatter[key as keyof FrontMatter] = value;
			}
		}
		return frontMatter;
	}

	function parseTopicFile(raw: string): [FrontMatter, string] {
		const sections = raw.split("---\n");
		// first entry is empty since it's before the first ---\n
		const frontMatter = parseFrontMatter(sections[1]);
		return [frontMatter, sections[2]];
	}

	function countObservations(prev: string, observations: Observation[]): string {
		return String(Number(prev) + observations.length);
	}

	function writeTopicFiles(sessionID: string, topicKey: string, observations: Observation[], summary: string, k: number = 4): void {
		const path = topicPath(sessionID, topicKey);

		var frontMatter: FrontMatter = { id: "", title: "", summary: "", updated: "", observationCount: "" };
		var body = "";
		if (existsSync(path)) {
			const existing = readFromFile(path)!;
			[frontMatter, body] = parseTopicFile(existing);
		} else {
			frontMatter = { id: topicKey, title: topicKey, summary: "", updated: "", observationCount: "" }
			body = ""
		}

		frontMatter.updated = new Date().toISOString();
		frontMatter.observationCount = countObservations(frontMatter.observationCount, observations);
		frontMatter.summary = summary;

        body += "\n" + observations.map(formatObservation).join("\n");

		atomicWrite(path, renderFrontMatter(frontMatter) + "\n" + body)
	}
	
	async function deriveSummary(observations: Observation[], k: number = 4): Promise<string> {
        let id: string | undefined;
        try {
            const s = await client.session.create({ body: { title: "obs-memory: summarise" } });
            id = s.data!.id;
            HELPER_SESSIONS.add(id);
            const transcript = observations.map(formatObservation).join("\n");
            const res = await client.session.prompt({
                path: { id },
                body: {
                    agent: "memory-summariser",
                    // model: { providerID: "opencode", modelID: "big-pickle" },
                    // system: "You summarise developer observations. Reply with one line, no markdown.",
                    parts: [{ type: "text", text: transcript }],
                },
            });
            const text = (res.data?.parts ?? [])
                .filter(p => p.type === "text")
                .map(p => p.text)
                .join("")

            return text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
        } catch {
            const countTag = countByTag(observations);
            const topK = countTag.split(", ").slice(0, k);
            return `obs: ${observations.length}; ${topK.join(", ")}`;
        } finally {
            if (id) {
                HELPER_SESSIONS.delete(id);
                await client.session.delete({ path: { id } }).catch(() => {});
            }
        }
	}

	function atomicWrite(path: string, content: string): void {
		const tmp = path + ".tmp";
		writeFileSync(tmp, content);
		renameSync(tmp, path);
	}

	function deriveTopicKey(filePath: string): string {
		const path = filePath.replace(/\\/g, "/");

		const parts = path.split("/");
		const srcIndex = parts.indexOf("src");
		if (srcIndex >= 0 && srcIndex + 1 < parts.length) {
			return parts[srcIndex + 1];
		}

		if (parts.length >= 2) {
			return parts[parts.length - 2];
		}
		return "other";
	}

	function groupObservationsByFilepath(observations: Observation[]): Record<string, Observation[]> {
		const groups: Record<string, Observation[]> = {};
		
		for (const obs of observations) {
			const filePath = obs.metadata?.filePath
			var key = "";
			if (!filePath) {
				key = "other";
			} else {
				key = deriveTopicKey(filePath);
			}

			if (!(key in groups)) {
				groups[key] = [];
			}
			groups[key].push(obs);
		}
		return groups;
	}

	return {
        config: async (cfg) => {
            cfg.agent = {
                ...cfg.agent,
                "memory-summariser": {
                    description: "Summarises obs-memory observations",
                    mode: "subagent",
                    model: "opencode/big-pickle",
                    maxSteps: 1,
                    prompt: "You summarise developer observations. Reply with one line, no markdown.",
                },
            };
        },

		"chat.message": async (input, output) => {
            if (HELPER_SESSIONS.has(input.sessionID)) return;
			mkdirSync(ROOT, { recursive: true });
			const text = output.parts
				.filter((p) => "type" in p && p.type === "text")
				.map((p) => ("text" in p ? p.text : ""))
				.join(" ");
			const obs = extractObservation("message", { text }, {});
			appendToFile(
				observationPath(input.sessionID),
				input.sessionID,
				formatObservation(obs),
				client
			);

			const buffer = readFromFile(observationPath(input.sessionID))!;
			const observations = parseObservations(buffer);
			const percent = (buffer.length / CONSOLIDATION_THRESHOLD) * 100;

			await client.tui.showToast({ body: { message: `Memory buffer at ${percent.toFixed(0)}% with [${observations.length}] observations`, variant: "info" }});
		},

		"experimental.session.compacting": async (input, output) => {
			try {
				const index = readFromFile(indexPath(input.sessionID));
				const journey = readFromFile(journeyPath(input.sessionID));

				if (!index && !journey) {
					const observations = readFromFile(observationPath(input.sessionID));
					if (observations && observations.length > 0) output.context.push("\n### Observations (sliced to 256 characters)\n" + observations.slice(0, 256));
				}
				if (index && index.length > 0) output.context.push("\n### Index.md (verbatim)\n" + index);
				if (journey && journey.length > 0) output.context.push("### Journey.md (verbatim)\n" + journey);

				
			} catch {}
		},
		
		"tool.execute.after": async (input, output) => {
            if (HELPER_SESSIONS.has(input.sessionID)) return;
			mkdirSync(ROOT, { recursive: true });
			const toolName = input.tool;
			const observation = extractObservation(toolName, input.args, output);
			appendToFile(
				observationPath(input.sessionID),
				input.sessionID,
				formatObservation(observation),
				client
			);
		}
		// "tool.execute.after": async (input, output) => {
		// 	mkdirSync(ROOT, { recursive: true });
		// 	appendToFile(observationPath(input.sessionID), `TOOL: ${input.tool}\nARGS: ${JSON.stringify(input.args)}\nOUTPUT: ${JSON.stringify(output)}\n\n`);
		// }
	};
};

