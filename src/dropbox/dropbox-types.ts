export interface DropboxOptions {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    fetchType?: 'fetch-node' | 'axios';
}

export interface GenerateRefreshTokenResult {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    uid: string;
    account_id: string;
}

export interface RefreshTokenResult {
    access_token: string;
    token_type: string;
    expires_in: number;
}

export interface HeaderArgs {
    [key: string]: any;
}

export interface DefaultHeaderOptions extends HeaderArgs {
    Authorization: string;
}

export interface DefaultFileHeaderOptions extends DefaultHeaderOptions {
    'Dropbox-API-Arg': string;
    'Content-Type': string;
}

export interface DropboxFileMetadata {
    name: string;
    path_lower: string;
    path_display: string;
    id: string;
    client_modified: string;
    server_modified: string;
    rev: string;
    size: number;
    is_downloadable: boolean;
    content_hash: string;
}

export interface DropboxDownloadResult {
    fileBuffer?: Buffer;
    fileBlob?: Blob;
}

export interface DropboxUploadResult extends DropboxFileMetadata {}

export interface DropboxUploadResultError {
    error_summary: string;
    error: {
        reason: { '.tag': string };
        retry_after: number;
    };
}

export interface DropboxSharedLinkResult {
    '.tag': string;
    url: string;
    id: string;
    name: string;
    path_lower: string;
    link_permissions: {
        resolved_visibility: { '.tag': string };
        requested_visibility: { '.tag': string };
        can_revoke: boolean;
        effective_audience: { '.tag': string };
        link_access_level: { '.tag': string };
        visibility_policies: { [key: string]: any }[];
        can_set_expiry: boolean;
        can_remove_expiry: boolean;
        allow_download: boolean;
        can_allow_download: boolean;
        can_disallow_download: boolean;
        allow_comments: boolean;
        team_restricts_comments: boolean;
        audience_options: { [key: string]: any }[];
        can_set_password: boolean;
        can_remove_password: boolean;
        require_password: boolean;
        can_use_extended_sharing_controls: boolean;
    };
    team_member_info: {
        team_info: { id: string; name: string };
        display_name: string;
        member_id: string;
    };
    preview_type: string;
    client_modified: string;
    server_modified: string;
    rev: string;
    size: number;
}

export interface DropboxSharedLinkResultError {
    error_summary: string;
    error: {
        '.tag': string;
    };
}

export interface DropboxGetSharedLinkResult {
    links: DropboxSharedLinkResult[];
    has_more: boolean;
}

export const DropboxDomains = {
    auth: {
        refreshToken: 'https://api.dropboxapi.com/oauth2/token',
        authorizeCode: 'https://www.dropbox.com/oauth2/authorize'
    },
    files: {
        content: 'https://content.dropboxapi.com/2/files',
        file: 'https://api.dropboxapi.com/2/files'
    },
    sharing: {
        sharedLink: 'https://api.dropboxapi.com/2/sharing'
    }
};

export interface RequestOptions {
    method: string;
    headers: any;
    body?: any;
    [key: string]: any;
}

export interface RequestResponse {
    ok: boolean;
    status: number;
    headers: any;
    data: any;
}
