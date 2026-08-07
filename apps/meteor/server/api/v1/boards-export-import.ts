import { generateBoardExportCSV, generateBoardExportJSON } from '../../lib/boards/export';
import { parseTrelloJSON, importTrelloBoard } from '../../lib/boards/import';
import { API } from '../api';
import { ajv, validateBadRequestErrorResponse, validateUnauthorizedErrorResponse } from '@rocket.chat/rest-typings';

// Schema for export request
const exportRequestSchema = ajv.compile({
  type: 'object',
  properties: {
    boardId: { type: 'string' },
    format: { type: 'string', enum: ['csv', 'json'] },
    listIds: { type: 'array', items: { type: 'string' }, nullable: true },
  },
  required: ['boardId', 'format'],
});

// Schema for import request
const importRequestSchema = ajv.compile({
  type: 'object',
  properties: {
    boardName: { type: 'string' },
    boardType: { type: 'string', enum: ['general', 'task', 'matters', 'leads'] },
  },
  required: ['boardName'],
});

const successSchema = ajv.compile<{ success: true }>({
  type: 'object',
  properties: { success: { type: 'boolean', enum: [true] } },
  required: ['success'],
  additionalProperties: true,
});

/**
 * POST /api/v1/boards.export
 * Export board in CSV or JSON format.
 * Returns downloadable URL and filename.
 */
API.v1.post(
  'boards.export',
  {
    authRequired: true,
    validateParams: exportRequestSchema,
    response: {
      200: successSchema,
      400: validateBadRequestErrorResponse,
      401: validateUnauthorizedErrorResponse,
    },
  },
  async function action() {
    const { userId } = this;
    const { boardId, format, listIds } = this.bodyParams as any;

    if (format === 'csv') {
      try {
        const csvMap = await generateBoardExportCSV(userId, boardId, listIds);

        if (Object.keys(csvMap).length === 0) {
          return API.v1.failure('No lists found to export');
        }

        // Combine all lists into a single CSV
        const allRows: string[] = [];
        let headerAdded = false;

        for (const csvContent of Object.values(csvMap)) {
          const lines = csvContent.split('\n');
          if (!headerAdded) {
            allRows.push(lines[0]); // Add header from first list
            headerAdded = true;
          }
          // Add all data rows (skip header)
          allRows.push(...lines.slice(1));
        }

        const combinedCSV = allRows.join('\n');
        this.setHeader('Content-Type', 'text/csv');
        this.setHeader(
          'Content-Disposition',
          `attachment; filename="board-export-${Date.now()}.csv"`,
        );
        return combinedCSV;
      } catch (error: any) {
        return API.v1.failure(error.message || 'Failed to export board as CSV');
      }
    } else if (format === 'json') {
      try {
        const jsonData = await generateBoardExportJSON(userId, boardId);
        this.setHeader('Content-Type', 'application/json');
        this.setHeader(
          'Content-Disposition',
          `attachment; filename="board-export-${Date.now()}.json"`,
        );
        return JSON.stringify(jsonData, null, 2);
      } catch (error: any) {
        return API.v1.failure(error.message || 'Failed to export board as JSON');
      }
    }

    return API.v1.failure('Invalid export format');
  },
);

/**
 * POST /api/v1/boards.import
 * Import board from Trello JSON export.
 * Accepts multipart/form-data with file upload.
 * Returns boardId and import status.
 */
API.v1.post(
  'boards.import',
  {
    authRequired: true,
  },
  async function action() {
    const { userId } = this;
    const { boardName, boardType = 'general' } = this.bodyParams as any;

    if (!boardName) {
      return API.v1.failure('boardName is required');
    }

    try {
      // Handle file upload from request
      let fileContent: string;

      if ((this as any).request.files && Object.keys((this as any).request.files).length > 0) {
        const fileField = Object.values((this as any).request.files)[0] as any;
        const file = Array.isArray(fileField) ? fileField[0] : fileField;
        fileContent = file.data.toString('utf-8');
      } else if (this.bodyParams.jsonData) {
        fileContent = this.bodyParams.jsonData;
      } else {
        return API.v1.failure('No file data provided');
      }

      // Parse JSON
      let trelloData;
      try {
        trelloData = JSON.parse(fileContent);
      } catch (parseError) {
        return API.v1.failure('Invalid JSON file');
      }

      // Validate and import
      const parsedData = await parseTrelloJSON(trelloData);
      const result = await importTrelloBoard(
        userId,
        parsedData,
        boardName,
        boardType as any,
      );

      return API.v1.success({
        boardId: result.boardId,
        cardCount: result.cardCount,
        listCount: result.listCount,
        message: `Imported ${result.cardCount} cards into ${result.listCount} lists`,
      });
    } catch (error: any) {
      return API.v1.failure(error.message || 'Failed to import board');
    }
  },
);
