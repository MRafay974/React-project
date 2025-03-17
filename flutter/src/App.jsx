// src/App.js
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import './styles.css';

// Initialize Supabase client
const supabaseUrl = 'https://ojgvglqaqvshyessqxhv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qZ3ZnbHFhcXZzaHllc3NxeGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIyMzc1NjMsImV4cCI6MjA1NzgxMzU2M30.lKQzLH4nofDyjRT0GOEBrG4R_OKbWGVZ8oUYFZR1bYk';
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = 'flutter'; // The bucket name in Supabase storage

function App() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingProject, setUploadingProject] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .storage
        .from(BUCKET_NAME)
        .list();

      if (error) {
        throw error;
      }

      const zipFiles = data.filter(file => file.name.endsWith('.zip') || file.name.endsWith('.rar'));
      
      const projectsData = await Promise.all(
        zipFiles.map(async (file) => {
          const { data: urlData } = await supabase
            .storage
            .from(BUCKET_NAME)
            .createSignedUrl(file.name, 60 * 60);
          
          const projectName = file.name.replace(/\.(zip|rar)$/, '');
          
          const { data: metadataObj } = await supabase
            .from('project_metadata')
            .select('*')
            .eq('file_name', file.name)
            .single();
          
          return {
            id: file.id,
            name: projectName,
            description: metadataObj?.description || 'No description provided',
            fileUrl: urlData?.signedUrl,
            fileName: file.name,
            fileSize: file.metadata?.size || 0,
            structure: metadataObj?.structure || {},
            createdAt: new Date(file.created_at || Date.now()),
            downloads: metadataObj?.downloads || 0
          };
        })
      );
      
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      const fileName = file.name.replace(/\.(zip|rar)$/, '');
      setProjectName(fileName);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!selectedFile || !projectName) {
      alert('Please provide a project name and select a zip or rar file');
      return;
    }

    if (!selectedFile.name.endsWith('.zip') && !selectedFile.name.endsWith('.rar')) {
      alert('Please upload a zip or rar file containing your React project');
      return;
    }

    setUploadingProject(true);
    setUploadProgress(0);

    try {
      const fileExtension = selectedFile.name.endsWith('.zip') ? 'zip' : 'rar';
      const fileName = `${projectName}.${fileExtension}`;
      
      let structure = {};
      if (fileExtension === 'zip') {
        const zip = new JSZip();
        const zipContents = await zip.loadAsync(selectedFile);
        structure = await extractProjectStructure(zipContents);
      }
      
      const { error: uploadError } = await supabase
        .storage
        .from(BUCKET_NAME)
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: true,
          onUploadProgress: (progress) => {
            const percent = (progress.loaded / progress.total) * 100;
            setUploadProgress(percent);
          },
        });

      if (uploadError) {
        throw uploadError;
      }
      
      const { error: metadataError } = await supabase
        .from('project_metadata')
        .upsert({
          file_name: fileName,
          project_name: projectName,
          description: projectDescription,
          structure: structure,
          downloads: 0,
          created_at: new Date().toISOString()
        });

      if (metadataError) {
        console.error('Error saving metadata:', metadataError);
      }
      
      alert('Project uploaded successfully!');
      setUploadingProject(false);
      setProjectName('');
      setProjectDescription('');
      setSelectedFile(null);
      setShowUploadForm(false);
      fetchProjects();
    } catch (error) {
      console.error('Error uploading project:', error);
      alert('Upload failed. Please try again.');
      setUploadingProject(false);
    }
  };

  const extractProjectStructure = async (zipContents) => {
    const structure = {};
    
    for (const [path, file] of Object.entries(zipContents.files)) {
      if (!file.dir) {
        const pathParts = path.split('/');
        
        if (pathParts.some(part => part.startsWith('__MACOSX') || part.startsWith('.'))) {
          continue;
        }
        
        let current = structure;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
        
        const fileName = pathParts[pathParts.length - 1];
        current[fileName] = 'file';
      }
    }
    
    return structure;
  };

  const downloadProject = async (project) => {
    try {
      const { error } = await supabase
        .from('project_metadata')
        .update({ downloads: project.downloads + 1 })
        .eq('file_name', project.fileName);
      
      if (error) {
        console.error('Error updating download count:', error);
      }
      
      window.open(project.fileUrl, '_blank');
      fetchProjects();
    } catch (error) {
      console.error('Error during download:', error);
    }
  };

  const renderStructure = (structure, level = 0) => {
    return (
      <ul className="structure-list">
        {Object.entries(structure).map(([key, value]) => (
          <li key={key} className="structure-item">
            {typeof value === 'object' ? (
              <div>
                <span className="folder-name">{key}</span>
                {renderStructure(value, level + 1)}
              </div>
            ) : (
              <span className="file-name">{key}</span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="container">
          <div className="header-content">
            <h1 className="app-title">React Project Hub</h1>
            <button 
              onClick={() => setShowUploadForm(!showUploadForm)} 
              className="btn btn-white"
            >
              {showUploadForm ? 'Cancel Upload' : 'Upload Project'}
            </button>
          </div>
        </div>
      </header>

      <main className="container main-content">
        {showUploadForm && (
          <div className="card upload-form">
            <h2 className="card-title">Upload React Project</h2>
            <form onSubmit={handleUpload}>
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="form-control"
            //      required
                />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  className="form-control"
                  rows="3"
                />
              </div>
              <div className="form-group">
                <label>Project ZIP or RAR File</label>
                <input
                  type="file"
                  accept=".zip,.rar"
                  onChange={handleFileChange}
                  className="form-control"
                  required
                />
                <p className="help-text">
                  Upload your React project as a ZIP or RAR file. Make sure it includes all necessary files.
                </p>
              </div>
              
              {uploadingProject ? (
                <div className="upload-progress-container">
                  <div className="progress-bar-container">
                    <div 
                      className="progress-bar"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                  <p className="progress-text">{Math.round(uploadProgress)}% Uploaded</p>
                </div>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={uploadingProject}
                >
                  Upload Project
                </button>
              )}
            </form>
          </div>
        )}

        <div className="card">
          <h2 className="card-title">Available React Projects</h2>
          
          {loading ? (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No projects available yet</p>
              <p className="empty-subtitle">Be the first to upload a React project!</p>
            </div>
          ) : (
            <div className="projects-grid">
              {projects.map((project) => (
                <div key={project.id} className="project-card">
                  <div className="project-content">
                    <h3 className="project-title">{project.name}</h3>
                    <p className="project-description">
                      {project.description || "No description provided"}
                    </p>
                    <div className="project-meta">
                      <span className="meta-tag">
                        Size: {Math.round(project.fileSize / 1024)} KB
                      </span>
                      <span className="meta-tag">
                        Downloads: {project.downloads}
                      </span>
                    </div>
                    <p className="upload-date">
                      Uploaded: {project.createdAt.toLocaleDateString()}
                    </p>
                    
                    <div className="structure-container">
                      <p className="structure-title">Project Structure:</p>
                      {renderStructure(project.structure)}
                    </div>
                    
                    <button
                      onClick={() => downloadProject(project)}
                      className="btn btn-primary download-btn"
                    >
                      <svg className="download-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Project
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p className="footer-copyright">React Project Sharing Hub © {new Date().getFullYear()}</p>
          <p className="footer-tagline">Upload, share, and download React projects easily</p>
        </div>
      </footer>
    </div>
  );
}

export default App;