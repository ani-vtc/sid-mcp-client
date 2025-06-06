/**
 * Query function for Google Cloud Run API 
 * @param {Object} options - Query configuration
 * @param {string} [options.prj="magnetic-runway-428121"] - Project ID
 * @param {string} [options.ds="schools"] - Dataset ID
 * @param {string} [options.tbl=""] - Table name
 * @param {string} [options.select="*"] - Fields to select
 * @param {string[]} [options.conditions=[]] - Query conditions
 * @returns {Promise<Array<Object>>} Promise containing query results
 */
export async function anyQuery({
  prj = "magnetic-runway-428121",
  ds = "schools",
  tbl = "",
  select = "*",
  conditions = []
} = {}) {
  try {
    // Base API configuration
    const baseUrl = "https://backend-v1-1010920399604.northamerica-northeast2.run.app";
    
    let idToken;
    try {
      console.log("Attempting to get identity token...");
      
      const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" + baseUrl, {
        headers: {
          "Metadata-Flavor": "Google"
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get identity token: ${response.status} ${response.statusText}`);
      }
      
      idToken = await response.text();
      console.log("Token received successfully");
    } catch (error) {
      console.error("MS Connection failed. Full error:", error);
      console.error("Error message:", error.message);
      if (error.cause) console.error("Parent error:", error.cause);
      throw error;
    }

    // Prepare the query
    const query = `SELECT ${select} FROM ${tbl} ${conditions.join(" ")};`;
    
    // Prepare the request body
    const body = {
      fun: "get",
      projectId: prj,
      datasetId: ds,
      query: query
    };
     
    // Make the API request
    const apiResponse = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(body)
    });
    
    // Parse the response
    if (apiResponse.ok) {
      const result = await apiResponse.json();
      return [result];
    } else {
      const errorText = await apiResponse.text();
      console.error(`API request failed: ${errorText}`);
      throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText}`);
    }
  } catch (error) {
    console.error("Connection failed:", error.message);
    throw error;
  }
}

export async function getDatabasesProd() {
  // Base API configuration
  const baseUrl = "https://backend-v1-1010920399604.northamerica-northeast2.run.app";

  const idToken = await googleAuth();
  try {
    const response = await fetch(`${baseUrl}/databases`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (response.ok) {
      const result = await response.json();
      console.log('result:', result);
      return result;
    } else {
      const errorText = await response.text();
      console.error(`API request failed: ${errorText}`);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error("Connection failed:", error.message);
    throw error;
  }
}

export async function getTableNames(db) {
  const baseUrl = "https://backend-v1-1010920399604.northamerica-northeast2.run.app";
  const idToken = await googleAuth();
  const response = await fetch(`${baseUrl}/tableNames/${db}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    }
  });
  if (response.ok) {
    const result = await response.json();
    console.log('Table result:', result);
    return result;
  } else {
    const errorText = await response.text();
    console.error(`API request failed: ${errorText}`);
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
}


async function googleAuth() {
   // Base API configuration
   const baseUrl = "https://backend-v1-1010920399604.northamerica-northeast2.run.app";
    
   let idToken;
   try {
     console.log("Attempting to get identity token...");
     
     const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" + baseUrl, {
       headers: {
         "Metadata-Flavor": "Google"
       }
     });
     
     if (!response.ok) {
       throw new Error(`Failed to get identity token: ${response.status} ${response.statusText}`);
     }
     
     idToken = await response.text();
     console.log("Token received successfully");
   } catch (error) {
     console.error("MS Connection failed. Full error:", error);
     console.error("Error message:", error.message);
     if (error.cause) console.error("Parent error:", error.cause);
     throw error;
   }
   return idToken;
}
export default { anyQuery, getDatabasesProd }; 