import { basename, dirname } from "node:path";

export type Observation = {
  timestamp: string;    // ISO 8601
  type: "tool" | "user" | "other";    // "tool" | "user" | "other"
  tag: string;     // "git" | "file-edit" | "search" | "bash" | "message"
  content: string;      // one-line description
  metadata: Record<string, any>;  // extracted context (files, sizes, etc.)
};

export function parseObservations(raw: string): Observation[] {
	if (raw.length === 0) return []

	const chunks = raw.split("\n## ").filter(c => c.length > 0);

	const observations = [];
	for (const chunk of chunks) {
		const lines = chunk.split("\n");
		// lines[0] = ## date.isostring
		// lines[1] = [TYPE: TAG]
		// lines[2] = content
		// lines[3]? = metadata: JSON.parse ()
		const timestamp = lines[0];
		const matches = lines[1].match(/\[(.*):\s*([^\]]+)\]/)!;
		const [type, tag] = [matches[1].toLowerCase(), matches[2]]
		let content = "";
		let metadata = {};
		for (let i = 2; i < lines.length; i++) {
			const line = lines[i]
			if (line.includes("METADATA:")) {
				metadata = parseMetadata(line);
				break;
			} else {
				content += (content ? "\n" : "") + line;
			}
		}

		observations.push({ timestamp, type, tag, content, metadata });
	}
	return observations as Observation[];
}

function parseMetadata(line: string): Record<string, any> {
	try {
		if (!line) return {};
		return JSON.parse(line
			.match(/METADATA:\s*(.*)$/)?.[1]
			?.trim() ?? "");
	} catch {
		return {}
	}
}

export function formatObservation(obs: Observation): string {
	let format = `## ${obs.timestamp}\n`;
	format += `[${obs.type.toUpperCase()}: ${obs.tag}]\n`;
	format += `${obs.content}\n`;
	if (Object.keys(obs.metadata).length) {
		format += `METADATA: ${JSON.stringify(obs.metadata)}\n` 
	}
	return format;
}

type ToolExtractor = {
	type: "tool" | "user" | "other";
	tag: string;
	content: (args: Record<string, any>, output: Record<string, any>) => string;
	metadata: (args: Record<string, any>, output: Record<string, any>) => Record<string, string>;
}

const extractors: Record<string, ToolExtractor> = {
	read: {
		type: "tool",
		tag: "file-read",
		content: (args) => `Read ${basename(args.filePath)}`,
		metadata: (args) => ({ filePath: args.filePath }),
	},
	write: {
		type: "tool",
		tag: "file-edit",
		content: (args) => `Wrote to ${basename(args.filePath)}`,
		metadata: (args) => ({ filePath: args.filePath }),
	},
	edit: {
		type: "tool",
		tag: "file-edit",
		content: (args, output) => {
			const diff = output.metadata?.filediff;
			const additions = diff?.additions ?? 0;
			const deletions = diff?.deletions ?? 0;
			return `Edited ${basename(args.filePath)} (+${additions} -${deletions})`;
		},
		metadata: (args, output) => ({ 
			filePath: args.filePath,
			additions: String(output.metadata?.filediff?.additions ?? 0),
			deletions: String(output.metadata?.filediff?.deletions ?? 0),
		}),
	},
	bash: {
		type: "tool",
		tag: "command",
		content: (args) => `Ran ${args.command.slice(0, 60)}`,
		metadata: (args, output) => ({ 
			command: args.command,
			exit: String(output.metadata?.exit ?? ""),
		}),
	},
	glob: {
		type: "tool",
		tag: "search",
		content: (args) => `Glob ${args.pattern} in ${basename(args.path)}`,
		metadata: (args, output) => ({ 
			pattern: args.pattern,
			path: args.path,
			count: String(output?.metadata?.count ?? 0),
		}),
	},
	grep: {
		type: "tool",
		tag: "search",
		content: (args) => `Grep "${args.pattern}" in ${basename(args.path)}`,
		metadata: (args, output) => ({ 
			pattern: args.pattern,
			path: args.path,
			count: String(output.metadata?.count ?? 0),
		}),
	},
	websearch: {
		type: "tool",

		tag: "network",
		content: (args) => `Searched "${args.query}"`,
		metadata: (args) => ({ query: args.query }),
	},
	webfetch: {
		type: "tool",
		tag: "network",
		content: (args) => `Fetched ${new URL(args.url).hostname}`,
		metadata: (args) => ({ url: args.url }),
	},
	skill: {
		type: "tool",
		tag: "system",
		content: (args) => `Loaded skill ${args.name}`,
		metadata: (args) => ({ name: args.name }),
	},
	task: {
		type: "tool",
		tag: "system",
		content: (args) => `Task ${args.description}`,
		metadata: (args) => ({ 
			description: args.description,
			subagent_type: args.subagent_type,
		}),
	},
	question: {
		type: "tool",
		tag: "system",
		content: () => `Asked a question`,
		metadata: (args) => ({
			count: String(args.questions?.length ?? 0),
		}),
	},
	todowrite: {
		type: "tool",
		tag: "system",
		content: (args) => {
			const completed = args.todos?.filter((t: any) => t.status === "completed").length ?? 0;
			const total = args.todos?.length ?? 0;
			return `Updated todos (${completed}/${total} completed)`;
		},
		metadata: (args) => ({ 
			total: String(args.todos?.length ?? 0),
		}),
	},

	message: {
		type: "user",
		tag: "message",
		content: (args) => args.text.slice(0, 100),
		metadata: () => {return {}},
	}
};

export function extractObservation(toolName: string, args: Record<string, any>, output: Record<string, any>): Observation {
	const extractor = extractors[toolName];
	if (!extractor) {
		return {
			timestamp: new Date().toISOString(),
			type: "other",
			tag: "other",
			content: toolName,
			metadata: {},
		};
	}
	return {
		timestamp: new Date().toISOString(),
		type: extractor.type,
		tag: extractor.tag,
		content: extractor.content(args, output),
		metadata: extractor.metadata(args, output),
	};
}