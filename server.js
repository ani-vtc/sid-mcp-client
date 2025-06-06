import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import wellknown from 'wellknown';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

import { Anthropic } from '@anthropic-ai/sdk';
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
dotenv.config();
import { anyQuery, getDatabasesProd, getTableNames } from './queryFunctions.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(express.json());

class MCPClient {

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
    this.mcp = new Client({
      name: "SID-Client",
      version: "1.0.0",
    });
    
    // Initialize Google Auth with default credentials
    // This will automatically use:
    // - Workload Identity when running on Cloud Run
    // - Service account JSON when running locally (if GOOGLE_APPLICATION_CREDENTIALS is set)
    this.googleAuth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  async cleanup() {
    if (this.transport) {
      await this.mcp.close();
    }
  }
  async connectToServer(serverScriptPath) {
    try {
      if (process.env.ENV == "dev") {
        const isJs = serverScriptPath.endsWith(".js");
        const isPy = serverScriptPath.endsWith(".py");
        if (!isJs && !isPy) {
          throw new Error("Server script must be a .js or .py file");
        }
        const command = isPy
          ? process.platform === "win32"
            ? "python"
            : "python3"
          : process.execPath;
    
        this.transport = new StdioClientTransport({
          command,
          args: [serverScriptPath],
        });
        this.mcp.connect(this.transport);
    
        const toolsResult = await this.mcp.listTools();
        this.tools = toolsResult.tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          };
        });
        console.log(
          "Connected to server with tools:",
          this.tools.map(({ name }) => name)
        );
      } else {
        // Get Google Cloud credentials
        // This will automatically use the appropriate authentication method:
        // - On Cloud Run: Uses the service account attached to the Cloud Run service
        // - Locally: Uses GOOGLE_APPLICATION_CREDENTIALS if set
        const client = await this.googleAuth.getClient();
        const token = await client.getAccessToken();
        const url = process.env.MCP_SERVER_URL;
        console.log('url:', url);
        this.transport = new StreamableHTTPClientTransport({
          url: url,
          opts: {
            headers: {
              'Authorization': `Bearer ${token.token}`,
            },
          },
        });
        await this.mcp.connect(this.transport);

        const toolsResult = await this.mcp.listTools();
        this.tools = toolsResult.tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          };
        });
        console.log(
          "Connected to MCP server with tools:",
          this.tools.map(({ name }) => name)
        );
      }
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }
  async processQuery(query) {
    const messages = query.map((msg) => {
      return {
        role: msg.isUser ? "user" : "assistant",
        content: msg.text,
      }
    });
    console.log("messages:", messages);
  
    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });
  
    const finalText = [];
    const toolResults = [];
  
    for (const content of response.content) {
      if (content.type === "text") {
        finalText.push(content.text);
      } else if (content.type === "tool_use") {
        const toolName = content.name;
        const toolArgs = content.input;
  
        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        toolResults.push(result);
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );
  
        messages.push({
          role: "user",
          content: result.content ,
        });
  
        const response = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages,
        });
  
        finalText.push(
          response.content[0].type === "text" ? response.content[0].text : ""
        );
      }
    }
  
    return finalText.join("\n");
  }
}

const client = new Client({
  name: "SID-Client",
  version: "1.0.0",
});

//Db config for cloud run/local
const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: null,
  };
  
  
//Get rows from table with pagination, sorting, and filtering 
// @param table: string - The name of the table to get rows from
// @param page: number - The page number to get
// @param pageSize: number - The number of rows per page
// @param sortBy: string - The column to sort by
// @param sortDirection: string - The direction to sort by
// @param filters: object - The filters to apply to the query
// @returns: object - The rows from the table
app.get('/api/rows/:table/:page/:pageSize', async (req, res) => {
  try {
    const { table, page, pageSize } = req.params;
    const { sortBy, sortDirection, filters } = req.query;
    
    console.log('Request params:', {
      table,
      page,
      pageSize,
      sortBy,
      sortDirection,
      filters
    });

    if (!table || !page || !pageSize) {
      return res.status(400).json({ error: 'Table name, page, and page size are required' });
    }

    const pageNum = parseInt(page);
    const limit = parseInt(pageSize);
    const offset = (pageNum - 1) * limit;

    // Build the WHERE clause for filters
    let whereClause = '';
    const filterParams = [];
    if (filters) {
      try {
        const filterObj = JSON.parse(filters);
        console.log('Parsed filters:', filterObj);
        
        const conditions = Object.entries(filterObj)
          .filter(([_, filter]) => filter.value && filter.value.trim() !== '')
          .map(([key, filter]) => {
            const { value, operator } = filter;
            // If it's a numerical comparison
            if (operator && !isNaN(Number(value))) {
              return `${key} ${operator} ${Number(value)}`;
            }
            // Default to LIKE for text search
            filterParams.push(`%${value}%`);
            return `${key} LIKE '%${value}%'`;
          });
        
        if (conditions.length > 0) {
          whereClause = 'WHERE ' + conditions.join(' AND ');
        }
      } catch (error) {
        console.error('Error parsing filters:', error);
        return res.status(400).json({ error: 'Invalid filters format' });
      }
    }

    // Build the ORDER BY clause
    let orderByClause = '';
    if (sortBy) {
      // Sanitize sortBy to prevent SQL injection
      const sanitizedSortBy = sortBy.replace(/[^a-zA-Z0-9_]/g, '');
      const sanitizedDirection = sortDirection === 'desc' ? 'DESC' : 'ASC';
      orderByClause = `ORDER BY ${sanitizedSortBy} ${sanitizedDirection}`;
    }

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM ${table} ${whereClause}`;
    
    // Get the actual data
    const dataQuery = `
      SELECT * FROM ${table} 
      ${whereClause} 
      ${orderByClause}
      LIMIT ${limit} OFFSET ${offset}
    `;

    console.log('Generated queries:', {
      countQuery,
      dataQuery,
      filterParams,
      limit,
      offset
    });

    let totalCount, rows;
    
    if (process.env.ENV == "dev") {
      if (!dbConfig.database) {
        return res.status(400).json({ error: 'Database not selected' });
      }
      const connection = await mysql.createConnection(dbConfig);
      
      try {
        // Get total count
        [totalCount] = await connection.execute(countQuery, filterParams);
        
        // Get paginated data
        const queryParams = [...filterParams, limit, offset];
        console.log('Executing query with params:', {
          query: dataQuery,
          params: queryParams
        });
        
        [rows] = await connection.execute(dataQuery, queryParams);
      } finally {
        await connection.end();
      }
    } else {
      // Get total count
      [totalCount] = await anyQuery({
        tbl: countQuery,
        select: '*',
        params: filterParams
      });
      
      // Get paginated data
      [rows] = await anyQuery({
        tbl: dataQuery,
        select: '*',
        params: [...filterParams, limit, offset]
      });
    }
    
    if (!rows || rows.length == 0) {
      return res.status(404).json({ error: 'No data found' });
    }
    
    const response = {
      rows,
      totalCount: totalCount[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount[0].total / limit)
    };

    console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error fetching table data:', error);
    res.status(500).json({ error: 'Failed to fetch table data', details: error.message });
  }
});

//Get table names from database
// @param db: string - The name of the database to get table names from
// @returns: object - The table names from the database
app.get('/api/tableNames/:db', async (req, res) => {
  try {
    const { db } = req.params;
    console.log('Attempting to fetch tables for database:', db);
    
    if (!db) {
      return res.status(400).json({ error: 'Database name is required' });
    }



    let rows;
    if (process.env.ENV == "dev") {
      try {
        // Set the database in the config
        dbConfig.database = db;   
        console.log('Database config:', { ...dbConfig, password: '***' });
        const connection = await mysql.createConnection(dbConfig);
        [rows] = await connection.execute('SHOW TABLES');
        await connection.end();
      } catch (dbError) {
        console.error('Database connection error:', dbError);
        return res.status(500).json({ 
          error: 'Failed to connect to database', 
          details: dbError.message 
        });
      }
    } else {
      try {
        rows = await getTableNames(db);
      } catch (queryError) {
        console.error('Query execution error:', queryError);
        return res.status(500).json({ 
          error: 'Failed to execute query', 
          details: queryError.message 
        });
      }
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No tables found in database' });
    }

    //console.log('Successfully fetched tables:', rows);
    res.json(rows);
  } catch (error) {
    console.error('Error in tableNames endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to fetch table names', 
      details: error.message 
    });
  }
});

//Get databases from server
// @param none
// @returns: object - The databases from the server
app.get('/api/databases', async (req, res) => {
  try {
    let rows;
    if (process.env.ENV == "dev") {
      const connection = await mysql.createConnection(dbConfig);
      [rows] = await connection.execute('SHOW DATABASES');
      await connection.end();
    } else {
      rows = await getDatabasesProd();
      console.log('rows:', rows);
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No databases found' });
    }
    res.json(rows);
  } catch (error) {
    console.error('Error fetching databases:', error);
    res.status(500).json({ error: 'Failed to fetch databases', details: error.message });
  }
});

// Message processing function with MCP integration
async function processMessage(messages) {
  try {
    // Debug: Check what tools are being converted
    const convertedTools = mcpToTool(client);
    //console.log("Tools being passed to Gemini:", JSON.stringify(convertedTools, null, 2));
    
    let chat;
    if (!chat) {
      chat = await genAI.chats.create({
        model: "gemini-2.5-flash-preview-05-20",
        history: messages.slice(0, messages.length - 1).map( msg => {
          return { 
            role: msg.isUser ? "user" : "model",
            parts: [{ text: msg.text }]
          }
        }),
        config: {
          temperature: 0.5,
          tools: [convertedTools],
          automaticFunctionCalling: {
            disable: true,
          }
        }
      })
    }
    const response = await chat.sendMessage({
      message: messages[messages.length - 1].text,
    });
    console.log('history:', chat.getHistory());
    console.log('text:', response.text);

    // Parse the response to check for database change action
    try {
      const parsedResponse = JSON.parse(response.text);
      console.log('parsedResponse:', parsedResponse);
      if (parsedResponse.action === 'CHANGE_DATABASE' && parsedResponse.database) {
        // Send a special response that the frontend can handle
        return JSON.stringify({
          type: 'DATABASE_CHANGE',
          database: parsedResponse.database,
          message: parsedResponse.message
        });
      }
    } catch (e) {
      // If response isn't JSON or doesn't have the expected format, return as normal
      console.log('Response is not a database change command:', e);
    }

    return response.text;
  } catch (error) {
    console.error('Error processing message:', error);
    throw error;
  }
}

// Chat endpoint for LLM interactions
app.post('/api/chat', async (req, res) => {
  try {
    const { messages} = req.body;
    console.log('Received messages:', messages);

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const response = await mcpClient.processQuery(messages);
    res.json({ response: response });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if dist directory exists before trying to serve static files
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  console.log('Serving static files from dist directory');
  // Serve static files from the React app build directory
  app.use(express.static(distPath));
  
  // For any request that doesn't match an API route, send the React app
  app.get('/', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log('Dist directory not found, serving API only.');
  //main();
  app.get('/', (req, res) => {
    res.send('API server is running. Frontend build not available.');
  });
}

// Initialize MCP client
const mcpClient = new MCPClient();

// Start the server
const PORT = process.env.PORT || 5051;
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  try {
    await mcpClient.connectToServer("../../sid-mcp/build/index.js");
  } catch (error) {
    console.error('Failed to connect to MCP server:', error);
  }
});




