import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HttpClientTransport } from "@modelcontextprotocol/sdk/client/http.js";
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { getDatabasesProd } from './queryFunctions.js';

dotenv.config();

//Db config for cloud run/local
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: null,
};

const mcpServer = new McpServer({
  name: "SID-DB-TOOLS",
  version: "1.0.0",
  capabilities: {
    tools: {}
  },
  tools: {},
});

//MCP SERVER TOOLS
mcpServer.tool(
  "getDatabases",
  "Get the list of databases on the server",
  {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async () => {
    try {
      let rows;
      if (process.env.ENV == "dev") {
        const connection = await mysql.createConnection(dbConfig);
        [rows] = await connection.execute('SHOW DATABASES');
        await connection.end();
      } else {
        rows = await getDatabasesProd();
      }
      if (!rows || rows.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: 'No databases found' })
          }]
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ databases: rows })
        }]
      };
    } catch (error) {
      console.error('Error fetching databases:', error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: 'Failed to fetch databases', details: error.message })
        }]
      };
    }
  }
);

mcpServer.tool(
  "setSelectedDatabase",
  "Change the currently selected database in the UI",
  {
    type: "object",
    properties: {
      database: {
        type: "string",
        description: "The name of the database to select"
      }
    },
    required: ["database"],
    additionalProperties: false
  },
  async ({ database }) => {
    try {
      // Verify the database exists
      let rows;
      if (process.env.ENV == "dev") {
        const connection = await mysql.createConnection(dbConfig);
        [rows] = await connection.execute('SHOW DATABASES');
        await connection.end();
      } else {
        rows = await getDatabasesProd();
      }
      
      // Return success response that main server can use to trigger UI update
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ 
            success: true,
            message: `Please return this Json object: {action: 'CHANGE_DATABASE', database: '${database}', message: ''} and fill in message with the response.`,
            database: database,
            action: 'CHANGE_DATABASE'  // Special flag for main server to handle
          })
        }]
      };
    } catch (error) {
      console.error('Error setting database:', error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: 'Failed to set database', details: error.message })
        }]
      };
    }
  }
);

// Start MCP server
async function startMcpServer() {
  try {
    console.log("Starting MCP server...");
    const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:8080';
    const transport = new HttpClientTransport(serverUrl);
    console.log(`Connecting to MCP server at ${serverUrl}`);
    await mcpServer.connect(transport);
    console.log("MCP Server is running and connected");
    
    // Debug: Log registered tools
    console.log("MCP Server tools registered:");
    console.log("- getDatabases");
    console.log("- setSelectedDatabase");
  } catch (error) {
    console.error("Error starting MCP server:", error);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal');
  process.exit(0);
});

startMcpServer(); 