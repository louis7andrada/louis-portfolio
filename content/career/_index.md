---
# Luis's page (luis.andrada.one): his work life, laid out like a resume / LinkedIn profile.
# The text is his standard resume (the version that got him the CIBC job, Louis 2026-10-14), kept as written.
# No phone, email or references' contacts here on purpose: the site's forms are the only way to reach him.
title: "Career"
description: "Luis Andrada, Toronto: research coordinator, data analyst and programmer. Five years at the University of Toronto Faculty of Dentistry in data validation, quality control, REDCap, automation and analysis."
headline: "Research Coordinator | Data Analyst | Quality Assurance | Computer Programming"
location: "Toronto, ON"
image: "/images/luis/portrait.jpg"
outputs: ["html"]

# Newest first. Several roles at one place are grouped under it, as LinkedIn does.
# "to: Present" = current (JSON-LD worksFor / jobTitle come from it; jobTitle = the first one listed).
# Optional per place: "place"; per role: "from", "points" (left out = not shown).
experience:
  - org: "CIBC"
    roles:
      - title: "Test Analyst, IT Quality Engineering"
        from: ""   # start month still to come from Louis ("Mmm YYYY", like the others)
        to: "Present"
        # General test-analyst duties (Louis, 2026-10-14: "I don't know exactly what I will be doing, so just put
        # things that test analysts do in general"). Replace with the real ones once he knows them.
        points:
          - "Design, document, and execute test plans, test cases, and test scripts based on business and technical requirements."
          - "Perform functional, regression, integration, and user acceptance testing across releases; verify that systems behave as specified before deployment."
          - "Identify, log, and track defects through resolution; investigate root causes, retest fixes, and communicate status to developers, business analysts, and project teams."
          - "Validate data integrity and system outputs using SQL queries and prepared test data across test environments."
          - "Maintain traceability between requirements, test cases, and defects; prepare test summary reports and sign-off documentation."
          - "Collaborate with cross-functional teams in Agile delivery to improve test coverage, quality processes, and test automation."
  - org: "University of Toronto, Faculty of Dentistry"
    place: "Toronto, ON"
    roles:
      - title: "Research Coordinator"
        from: "Jul 2025"
        to: "Present"
        points:
          - "Design and execute data validation and quality-control procedures across active research studies; identify discrepancies, out-of-range values, and logic errors before reporting or downstream use."
          - "Administer and maintain REDCap as the team's primary data-management platform; configure system logic and validation rules and test new instruments and system updates before deployment."
          - "Provide first-line technical support for REDCap; investigate system and data issues, identify root causes, implement corrective actions, and escalate when appropriate."
          - "Develop and maintain quality-control documentation, including procedures, issue records, corrective actions, and operational documentation."
          - "Use Python scripting, Microsoft Power Automate, Microsoft PowerToys, Windows batch files, and AutoHotkey to automate repetitive data-processing, reminders, scheduling, application-launch, file-management, and desktop workflow tasks."
          - "Coordinate participant booking and scheduling workflows, including automated email reminders and calendar notifications through Microsoft Power Automate; use PowerToys and desktop automation to reduce repetitive manual steps and improve day-to-day execution efficiency."
          - "Collect, analyze, and report quantitative research data using IBM SPSS, R, and STATA; prepare summaries, visualizations, and briefing materials for senior researchers and institutional committees."
          - "Coordinate with investigators, research staff, and external partner labs to resolve data-quality issues and communicate findings to technical and non-technical stakeholders."
          - "Ensure activities adhere to UofT ethics, FIPPA, and OCAP requirements and maintain secure, confidential handling of participant data."
      - title: "Data Analyst"
        from: "Oct 2023"
        to: "Jul 2025"
        points:
          - "Collected, analyzed, and reported quantitative and qualitative research data using IBM SPSS, R, and STATA; prepared summaries and visualizations for publications and institutional reports."
          - "Designed and administered survey questionnaires and data-collection instruments across concurrent research projects; maintained data integrity and platform consistency throughout study lifecycles."
          - "Queried databases using SQL to generate reports on research outputs, participant data, and study metrics; identified discrepancies and implemented corrective procedures."
          - "Built and maintained relational databases to store, organize, and query research data; designed front-end research tools and study websites using JavaScript and React."
          - "Developed research outreach websites using HTML, CSS, JavaScript/TypeScript, React, and related web tooling; deployed sites through Netlify."
          - "Prepared ad hoc reports for senior investigators and institutional stakeholders and trained staff and students on data systems, entry procedures, and analytical workflows."
      - title: "Research Assistant"
        from: "Oct 2021"
        to: "Sep 2023"
        points:
          - "Built and maintained institutional databases to organize and query research data across concurrent study projects."
          - "Designed results tables and data summaries for academic papers, committee presentations, and institutional records."
          - "Organized electronic and physical filing systems and trained graduate students on data systems and procedures."

education:
  - credential: "Certificate in Project Management"
    school: "University of Toronto, School of Continuing Studies"
    place: "Toronto, ON"
    years: "2025 – 2026"
    detail: "Foundations of Project Management | Leading Projects in Organizations | Project Tools and Techniques"
  - credential: "Advanced Diploma, Computer Programming and Analysis"
    honours: "Dean's Honour List (GPA 3.5+)"
    school: "George Brown College"
    place: "Toronto, ON"
    years: "2021 – 2024"
    detail: "Python, Java, C#, C++, JavaScript, TypeScript, React, SQL/MySQL; database design and management; full-stack web development; Git/GitHub"

certifications:
  - name: "Applied AI in Medicine Workshop Series"
    issuer: "Temerty Faculty of Medicine, University of Toronto"
    year: "2025"
    detail: "Large Language Models in Healthcare | Complex Prompt Engineering | Cybersecurity Best Practices"
  - name: "Data Analysis Workshops – R and Stata"
    issuer: "OISE, Ontario Institute for Studies in Education, University of Toronto"
    year: "2025"
  - name: "Fundamentals of OCAP"
    issuer: "First Nations Information Governance Centre – Online, Canada"
    year: "2024"
    detail: "Data sovereignty, First Nations collective rights, and Indigenous information governance principles"

competencies:
  - "Data Validation, Quality Control & Discrepancy Resolution"
  - "System Configuration, Functional Checks & Pre-Deployment Testing"
  - "Python Scripting, Data Processing & Workflow Automation"
  - "SQL / MySQL: Querying, Validation & Data Extraction"
  - "REDCap Administration, Logic, Validation & Testing"
  - "Process Automation: Power Automate, PowerToys, Batch & AutoHotkey"
  - "Programming: Python, Java, C#, C++, JavaScript & TypeScript"
  - "Git / GitHub: Version Control & Development Workflows"
  - "Technical Documentation, Issue Tracking & Corrective Actions"
  - "Data Analysis & Reporting: R, SPSS, STATA, Excel & Power BI"
  - "Project Coordination, Risk Identification & Stakeholder Communication"
  - "Microsoft 365, Visual Studio Code & Windows Productivity Tooling"
  - "Web Development: HTML, CSS, React, Tailwind CSS & Netlify Deployment"
  - "AI Tools: ChatGPT, Claude & Microsoft Copilot"
  - "AI Prompt Engineering, applied LLMs"

skills:
  - group: "Programming"
    items: ["Python", "Java", "C#", "C++", "JavaScript", "TypeScript", "HTML", "CSS"]
  - group: "Web & Deployment"
    items: ["React", "Tailwind CSS", "Netlify", "Visual Studio Code"]
  - group: "Databases"
    items: ["SQL", "MySQL", "Oracle SQL Developer", "MongoDB", "Microsoft Access"]
  - group: "Quality & Data Systems"
    items: ["REDCap", "data validation", "quality control", "system configuration", "pre-deployment testing"]
  - group: "Automation & Productivity"
    items: ["Microsoft Power Automate", "Microsoft PowerToys", "Windows batch (.bat)", "AutoHotkey"]
  - group: "Version Control"
    items: ["Git", "GitHub"]
  - group: "Data Analysis"
    items: ["IBM SPSS", "R", "RStudio", "STATA", "Excel", "Power BI"]
  - group: "AI Tools"
    items: ["ChatGPT", "Claude", "Microsoft Copilot", "prompt engineering", "applied LLMs"]
  - group: "Microsoft 365"
    items: ["Outlook", "Word", "Excel", "PowerPoint", "Teams", "SharePoint"]
  - group: "Other"
    items: ["Adobe Creative Suite", "axiUm"]

languages:
  - name: "English"
    level: "C2 – CELPIP Level 12 – Fluent / Near-native proficiency"
  - name: "Portuguese"
    level: "Native proficiency"
  - name: "French"
    level: "CEFR B1 – Upper-intermediate reading and listening comprehension / Intermediate spoken communication – Actively studying"
  - name: "Spanish"
    level: "Conversational understanding"
---
Research data professional and programmer with 5 years of progressive experience at the University of Toronto Faculty of Dentistry, specializing in data validation, quality control, system administration, process automation, and quantitative analysis. Experienced in configuring and testing electronic data-capture systems, investigating discrepancies and logic errors, documenting corrective actions, and communicating technical findings to technical and non-technical stakeholders. Advanced Diploma in Computer Programming and Analysis with programming experience in Python, Java, C#, C++, JavaScript, TypeScript, SQL/MySQL, and web technologies. Hands-on workflow automation using Microsoft Power Automate, Microsoft PowerToys, Windows batch scripting, and AutoHotkey. Uses Git/GitHub and AI tools including ChatGPT, Claude, and Microsoft Copilot to improve development, analysis, documentation, and operational efficiency.
