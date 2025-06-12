import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { z } from "zod";
import dotenv from "dotenv";
import { Client } from "@elastic/elasticsearch";

dotenv.config();

const server = new McpServer({
  name: "Elasticsearch MCP",
  description:
    "A server that retrieves data related with invoices from Elasticsearch",
  version: "1.0.0",
  tools: [
    {
      name: "get-semantic-search-results",
      parameters: {
        q: {
          type: "string",
          description: "The query string to search for",
        },
      },
    },
    {
      name: "get-search-by-date-results",
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
  `Get the results of a search by date query based on a from and to date. 
  
  This query will return results based on the issue_date field in the Elasticsearch index. 
  
  This tool must be used when the user is asking for information about a specific date range.
  
  All the results will be related with invoices.`,
  {
    from: z.string(),
    to: z.string(),
  },
  async (input) => {
    const { from, to } = input;

    console.log("from", from);
    console.log("to", to);

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

    console.log("populatedResults", populatedResults);

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
  `Get the results of a semantic search query based on a query string. 
  
  This query will return results based on the semantic field in the Elasticsearch index. 
  
  This tool must be used when the user is asking for information about a specific topic or concept.
  
  All the results will be related with invoices.`,
  {
    q: z.string(),
  },
  async (input) => {
    const { q } = input;

    console.log("q", q);

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

    console.log("populatedResult1", populatedResults);

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

app.use(express.json());

const transport: StreamableHTTPServerTransport =
  new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // set to undefined for stateless servers
  });

// Setup routes for the server
const setupServer = async () => {
  await server.connect(transport);
};

app.post("/mcp", async (req: Request, res: Response) => {
  console.log("Received MCP request:", req.body);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

app.delete("/mcp", async (req: Request, res: Response) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// Start the server
const PORT = process.env.PORT || 3000;
setupServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to set up the server:", error);
    process.exit(1);
  });
// // to support multiple simultaneous connections we have a lookup object from
// // sessionId to transport
// const transports: { [sessionId: string]: SSEServerTransport } = {};

// app.get("/sse", async (req: Request, res: Response) => {
//   // Get the full URI from the request
//   const host = req.get("host");

//   const fullUri = `https://${host}/es-queries`;
//   const transport = new SSEServerTransport(fullUri, res);

//   transports[transport.sessionId] = transport;
//   res.on("close", () => {
//     delete transports[transport.sessionId];
//   });
//   await server.connect(transport);
// });

// app.post("/es-queries", async (req: Request, res: Response) => {
//   const sessionId = req.query.sessionId as string;
//   const transport = transports[sessionId];
//   if (transport) {
//     await transport.handlePostMessage(req, res);
//   } else {
//     res.status(400).send("No transport found for sessionId");
//   }
// });

// app.get("/", (_req, res) => {
//   res.send("MCP server is running!");
// });

// const PORT = process.env.PORT || 3000;

// app.listen(PORT, () => {
//   console.log(`✅ Server is running at http://localhost:${PORT}`);
// });
