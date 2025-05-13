import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

import dotenv from "dotenv";
import { Client } from "@elastic/elasticsearch";

dotenv.config();

const server = new McpServer({
  name: "Elasticsearch MCP",
  description: "A server that provides Elasticsearch queries",
  version: "1.0.0",
  tools: [
    {
      name: "get-semantic-search-results",
      description:
        "Get the results of a semantic search query based on a query string",
      parameters: {
        q: {
          type: "string",
          description: "The query string to search for",
        },
      },
    },
    {
      name: "get-search-by-date-results",
      description:
        "Get the results of a search by date query based on a from and to date",
      parameters: {
        from: {
          type: "string",
          description: "The start date of the search",
        },
        to: {
          type: "string",
          description: "The end date of the search",
        },
      },
    },
  ],
});

const ELASTICSEARCH_ENDPOINT = process.env.ELASTICSEARCH_ENDPOINT;
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;
const INDEX = process.env.INDEX_NAME;

const _client = new Client({
  node: ELASTICSEARCH_ENDPOINT,
  auth: {
    apiKey: ELASTICSEARCH_API_KEY ?? "",
  },
});

const getSearchByDateResults = server.tool(
  "get-search-by-date-results",
  "Get the results of a search by date query based on a from and to date",
  {
    from: z.string(),
    to: z.string(),
  },
  async (input) => {
    const { from, to } = input;

    if (!from || !to) {
      return {
        content: [
          {
            type: "text",
            text: "Both fromDate and toDate parameters are required",
          },
        ],
        isError: true,
        _meta: { code: "MISSING_PARAMETERS" },
      };
    }

    const formattedFrom = formatDate(new Date(from));
    const formattedTo = formatDate(new Date(to));

    function formatDate(date: Date) {
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }

    const results = await _client.search({
      index: INDEX,
      query: {
        range: {
          issue_date: {
            gte: formattedFrom,
            lte: formattedTo,
            format: "dd/MM/yyyy",
          },
        },
      },
    });

    const populatedResults = results.hits.hits.map((hit) => {
      return JSON.stringify(hit._source);
    });

    return {
      content: [
        {
          type: "text",
          text: populatedResults.join("\n"),
        },
      ],
    };
  }
);

const getSemanticSearchResults = server.tool(
  "get-semantic-search-results",
  "Get the results of a semantic search query based on a query string",
  {
    q: z.string(),
  },
  async (input) => {
    const { q } = input;

    if (!q) {
      return {
        content: [
          {
            type: "text",
            text: "The query parameter is required",
          },
        ],
        isError: true,
        _meta: { code: "MISSING_PARAMETERS" },
      };
    }

    const results = await _client.search({
      index: INDEX,
      query: {
        semantic: {
          field: "semantic_field",
          query: q,
        },
      },
    });

    const populatedResults = results.hits.hits.map((hit) => {
      return JSON.stringify(hit._source);
    });

    return {
      content: [
        {
          type: "text",
          text: populatedResults.join("\n"),
        },
      ],
    };
  }
);

const app = express();

// to support multiple simultaneous connections we have a lookup object from
// sessionId to transport
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get("/sse", async (req: Request, res: Response) => {
  // Get the full URI from the request
  const host = req.get("host");

  const fullUri = `https://${host}/es-queries`;
  const transport = new SSEServerTransport(fullUri, res);

  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/es-queries", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No transport found for sessionId");
  }
});

app.get("/", (_req, res) => {
  res.send("MCP server is running!");
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
